import { randomUUID } from "node:crypto";
import { Config } from "../../../config";
import {
  estimateTokenCount,
  estimateWorkflowMessageTokenCount,
  getChatModel,
  truncateContextToTokenLimit,
} from "../provider";
import { fetchStructuredTools } from "../../../tools/index";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  UsageMetadata,
} from "@langchain/core/messages";
import { emitEvent } from "../../../emit";
import { PromptTemplate } from "@langchain/core/prompts";
import { WorkflowMessage } from "../types";

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
    const limitedChatContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS,
    );

    const limitedChatContextTokens =
      estimateWorkflowMessageTokenCount(limitedChatContext);

    const limitedToolContext = truncateContextToTokenLimit(
      results,
      Config.MAX_TOOL_TOKENS,
    );

    const limitedToolContextTokens =
      estimateWorkflowMessageTokenCount(limitedToolContext);

    await emitEvent({
      type: "debug",
      message: `Truncated chat context to ${limitedChatContextTokens}/${Config.MAX_CONTEXT_TOKENS} tokens and tool context to ${limitedToolContextTokens}/${Config.MAX_TOOL_TOKENS} tokens.`,
    });

    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      currentDate: new Date().toISOString().split("T")[0],
    });

    const model = getChatModel("high");
    const tools = await fetchStructuredTools();

    const modelWithTools = model.bindTools ? model.bindTools(tools) : model;

    const response = await modelWithTools.invoke([
      new SystemMessage(formattedPrompt),
      ...convertMessages(limitedChatContext),
      ...convertMessages(limitedToolContext),
    ]);

    // Check if the response is a tool call
    if (response.tool_calls && response.tool_calls.length > 0) {
      // Format into the response and return
      return {
        __type: "tool",
        usage: response.usage_metadata,
        tool: response.tool_calls.map((call) => ({
          name: call.name,
          input: call.args,
          id: call.id || randomUUID(),
        })),
      };
    }

    if (response.content) {
      if (!Array.isArray(response.content)) {
        await emitEvent({ type: "answer", message: response.content });
        return {
          __type: "text",
          usage: response.usage_metadata,
          text: response.content,
        };
      }

      const text: string[] = [];

      response.content.forEach((block) => {
        if (block.type == "text") {
          text.push(block.text as string);
        }

        console.warn("Unrecognized block type:", block.type);
      });

      if (text.length > 0) {
        await emitEvent({ type: "answer", message: text.join("\n") });
        return {
          __type: "text",
          usage: response.usage_metadata,
          text: text.join("\n"),
        };
      }
    }

    throw new Error("Unrecognized response format");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await emitEvent({
      type: "error",
      message: `Completion error: ${errorMessage}`,
    });
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
