import { UsageMetadata } from "@langchain/core/messages";
import {
  estimateTokenCount,
  getChatModel,
  truncateContextToTokenLimit,
} from "../../internals/model";
import { Config } from "../../internals/config";
import { PromptTemplate } from "@langchain/core/prompts";
import { emitEvent } from "../../internals/event-client";

export type ObservationResult = {
  observations: string;
  usage?: UsageMetadata;
};

export async function observation(
  context: string[],
  actionResult: string,
): Promise<ObservationResult> {
  let content = "";
  try {
    const count = estimateTokenCount(actionResult);
    if (count < Config.MIN_TOOL_TOKENS) {
      // The result is small enough to just use as is
      return {
        observations: actionResult,
      };
    }

    if (count > Config.MAX_CONTEXT_TOKENS) {
      throw new Error(
        `Context token limit exceeded: ${count} > ${Config.MAX_CONTEXT_TOKENS}`,
      );
    }

    // Here we know that the context is within the token limits

    const promptTemplate = observationPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      actionResult: actionResult,
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    if (response.content && !Array.isArray(response.content)) {
      content = response.content as string;
      await emitEvent({ type: "observation", message: content });

      return {
        observations: content,
        usage: response.usage_metadata,
      };
    }

    throw new Error("Failed to generate observation");
  } catch (error) {
    await emitEvent({
      type: "error",
      message: `Observation error: ${(error as Error).message}. Full response: ${content}`,
    });
    throw error;
  }
}

export function observationPromptTemplate() {
  const templateString = `Summarize the following information, extract insights, values, or context that seems the most important.

<action-result>
{actionResult}
</action-result>
`;

  const prompt = new PromptTemplate({
    template: templateString,
    inputVariables: ["actionResult"],
  });

  return prompt;
}
