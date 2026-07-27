import { WorkflowStreamClient } from "@temporalio/workflow-streams/client";
import { randomUUID } from "node:crypto";
import { Config } from "../../../config";
import {
  estimateWorkflowMessageTokenCount,
  getStreamingChatModel,
  truncateContextToTokenLimit,
} from "../provider";
import { fetchStructuredTools } from "../../../tools/index";
import {
  AIMessage,
  ContentBlock,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  UsageMetadata,
} from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { WorkflowMessage } from "../types";
import { Context } from "@temporalio/activity";

export interface TextDelta {
  text: string;
}

export interface RetryEvent {
  attempt: number;
}

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

    const deltas = streamClient.topic<TextDelta>("delta");
    const retry = streamClient.topic<RetryEvent>("retry");
    const close = streamClient.topic<Record<string, never>>("close");

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

    const toolBlocks: any[] = [];
    const textBlocks: (string | ContentBlock)[] = [];

    let firstBlock = true;
    for await (const chunk of stream) {
      // Check if a tool call is being made

      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        console.log("Tool call detected:", chunk.tool_calls);
        toolBlocks.push(...chunk.tool_calls);
      }

      if (chunk.content) {
        console.log("Content chunk received:", chunk.content);
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
    close.publish({});

    // Check if the response is a tool call
    if (toolBlocks && toolBlocks.length > 0) {
      // Format into the response and return
      return {
        __type: "tool",
        usage: undefined,
        tool: toolBlocks.map((call) => ({
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
        return {
          __type: "text",
          usage: undefined,
          text: text.join(""),
        };
      }
    }

    throw new Error("Unrecognized response format");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Completion error:", errorMessage);
    throw error;
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
