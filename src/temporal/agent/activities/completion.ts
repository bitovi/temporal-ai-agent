import { WorkflowStreamClient } from "@temporalio/workflow-streams/client";
import { randomUUID } from "node:crypto";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { Config } from "../../../config";

const tracer = trace.getTracer("temporal-ai-agent");
import {
  getStreamingChatModel,
  truncateContextToTokenLimit,
} from "../provider";
import { fetchStructuredTools } from "../../../tools/index";
import {
  AIMessage,
  AIMessageChunk,
  ContentBlock,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  UsageMetadata,
} from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { WorkflowMessage } from "../types";
import { Context } from "@temporalio/activity";
import {
  STREAM_TOPIC,
  type CloseEvent,
  type RetryEvent,
  type TextDelta,
} from "../stream-topics";

export type CompletionResult =
  | {
      __type: "text";
      text: string;
      usage?: UsageMetadata;
    }
  | {
      __type: "tool";
      tool: {
        name: string;
        input: Record<string, any>;
        id: string;
      }[];
      usage?: UsageMetadata;
    };

export async function completion(
  context: WorkflowMessage[],
  results: WorkflowMessage[],
): Promise<CompletionResult> {
  const span = tracer.startSpan("gen_ai.completion", {
    kind: SpanKind.CLIENT,
    attributes: {
      "gen_ai.system": Config.MODEL_PROVIDER,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.message_count": context.length + results.length,
    },
  });

  try {
    const attempt = Context.current().info.attempt;
    await using streamClient = WorkflowStreamClient.fromWithinActivity({
      batchInterval: "200 milliseconds",
    });

    const limitedChatContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS,
    );

    const limitedToolContext = truncateContextToTokenLimit(
      results,
      Config.MAX_TOOL_TOKENS,
    );

    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      currentDate: new Date().toISOString().split("T")[0],
    });

    const model = getStreamingChatModel("high");
    const tools = await fetchStructuredTools();

    const deltas = streamClient.topic<TextDelta>(STREAM_TOPIC.delta);
    const retry = streamClient.topic<RetryEvent>(STREAM_TOPIC.retry);
    const close = streamClient.topic<CloseEvent>(STREAM_TOPIC.close);

    // Tell consumers an earlier attempt's deltas are stale.
    if (attempt > 1) {
      retry.publish({ attempt }, { forceFlush: true });
    }

    const modelWithTools = model.bindTools ? model.bindTools(tools) : model;

    const stream = await modelWithTools.stream([
      new SystemMessage(formattedPrompt),
      ...convertMessages(limitedChatContext),
      ...convertMessages(limitedToolContext),
    ]);

    const textBlocks: (string | ContentBlock)[] = [];
    let usage: UsageMetadata | undefined;
    // Accumulate all chunks so tool_call args are fully assembled before we inspect them.
    let gathered: AIMessageChunk | undefined;

    let firstBlock = true;
    for await (const chunk of stream) {
      // Keep the Activity alive during long model streams and enable retries.
      Context.current().heartbeat();

      gathered = gathered
        ? (gathered.concat(chunk) as AIMessageChunk)
        : (chunk as AIMessageChunk);

      if (chunk.usage_metadata) {
        usage = usage
          ? {
              input_tokens:
                usage.input_tokens + chunk.usage_metadata.input_tokens,
              output_tokens:
                usage.output_tokens + chunk.usage_metadata.output_tokens,
              total_tokens:
                usage.total_tokens + chunk.usage_metadata.total_tokens,
            }
          : chunk.usage_metadata;
      }

      // Publish text deltas as they arrive; skip chunks that only carry tool call fragments.
      if (chunk.content) {
        // console.log("Content chunk received:", chunk.content);
        if (typeof chunk.content == "string") {
          deltas.publish(
            { text: chunk.content },
            firstBlock ? { forceFlush: true } : undefined,
          );
          firstBlock = false;
          textBlocks.push(...chunk.content);
        } else {
          if (chunk.content.length == 0) {
            console.warn("Received empty content chunk:", chunk.content);
            continue;
          }

          const textContent: string = chunk.content
            .filter((block) => block.type == "text")
            .map((block) => block.text)
            .join("");

          deltas.publish(
            { text: textContent },
            firstBlock ? { forceFlush: true } : undefined,
          );
          firstBlock = false;
          textBlocks.push(...chunk.content);
        }
      }
    }

    // After the stream is complete, signal to consumers that the stream is closed
    close.publish({}, { forceFlush: true });

    // Attach token usage to the span once the stream is fully consumed.
    if (usage) {
      span.setAttributes({
        "gen_ai.usage.input_tokens": usage.input_tokens ?? 0,
        "gen_ai.usage.output_tokens": usage.output_tokens ?? 0,
        "gen_ai.usage.total_tokens": usage.total_tokens ?? 0,
      });
    }

    // Read tool calls from the fully assembled message so args are complete.
    const completedToolCalls = gathered?.tool_calls ?? [];
    if (completedToolCalls.length > 0) {
      console.log("Tool calls assembled:", completedToolCalls);
      span.setAttribute("gen_ai.response.type", "tool_calls");
      span.setAttribute(
        "gen_ai.response.tool_count",
        completedToolCalls.length,
      );
      span.setStatus({ code: SpanStatusCode.OK });
      return {
        __type: "tool",
        usage,
        tool: completedToolCalls.map((call) => ({
          name: call.name,
          input: call.args,
          id: call.id || randomUUID(),
        })),
      };
    }

    if (textBlocks && textBlocks.length > 0) {
      const text: string[] = [];

      textBlocks.forEach((block) => {
        if (typeof block === "string") {
          text.push(block);
        } else if (block.type == "text") {
          text.push(block.text as string);
        } else {
          console.warn("Unrecognized block type:", block.type);
        }
      });

      if (text.length > 0) {
        span.setAttribute("gen_ai.response.type", "text");
        span.setStatus({ code: SpanStatusCode.OK });
        return {
          __type: "text",
          usage,
          text: text.join(""),
        };
      }
    }

    throw new Error("Unrecognized response format");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Completion error:", errorMessage);
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
    throw error;
  } finally {
    span.end();
  }
}

export function thoughtPromptTemplate() {
  const templateString = `You are a helpful and friendly chat assistant.
The current date is {currentDate}.
`;

  const prompt = new PromptTemplate({
    template: templateString,
    inputVariables: ["currentDate"],
  });

  return prompt;
}

function convertMessages(messages: WorkflowMessage[]) {
  return messages.map((entry) => {
    switch (entry.role) {
      case "assistant":
        return new AIMessage(entry.message);
      case "user":
        return new HumanMessage(entry.message);
      case "tool_call":
        return new AIMessage({
          tool_calls: [
            {
              type: "tool_call",
              args: entry.input,
              name: entry.name,
              id: entry.id,
            },
          ],
        });
      case "tool_result":
        return new ToolMessage({
          tool_call_id: entry.id,
          content: entry.output,
          name: entry.name,
        });
      default:
        //@ts-expect-error
        throw new Error(`Unrecognized role: ${entry.role}`);
    }
  });
}
