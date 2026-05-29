import { randomUUID } from "node:crypto";
import { Config } from "../../internals/config";
import {
  getChatModel,
  truncateContextToTokenLimit,
} from "../../internals/model";
import {
  fetchStructuredTools,
  fetchStructuredToolsAsString,
} from "../../internals/tools";
import { UsageMetadata } from "@langchain/core/messages";
import { emitEvent } from "../../internals/event-client";
import { PromptTemplate } from "@langchain/core/prompts";

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

export async function completion(context: string[]): Promise<CompletionResult> {
  try {
    const limitedContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS,
    );

    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      currentDate: new Date().toISOString().split("T")[0],
      previousSteps: limitedContext.join("\n"),
      availableActions: await fetchStructuredToolsAsString(),
    });

    const model = getChatModel("high");
    const tools = await fetchStructuredTools();

    const modelWithTools = model.bindTools ? model.bindTools(tools) : model;

    const response = await modelWithTools.invoke([
      { role: "user", content: formattedPrompt },
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

<previous-conversation-context>
{previousSteps}
</previous-conversation-context>
`;

  const prompt = new PromptTemplate({
    template: templateString,
    inputVariables: ["currentDate", "previousSteps"],
  });

  return prompt;
}
