import { UsageMetadata } from "@langchain/core/messages";
import { getChatModel, truncateContextToTokenLimit } from "../provider";
import { Config } from "../../../config";
import { emitEvent } from "../../../emit";
import { PromptTemplate } from "@langchain/core/prompts";
import { WorkflowMessage } from "../types";

export type CompactionResult = {
  context: WorkflowMessage[];
  usage?: UsageMetadata;
};

export async function compact(
  context: WorkflowMessage[],
): Promise<CompactionResult> {
  let content = "";
  try {
    const limitedContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS,
    );

    const compactTemplate = compactPromptTemplate();
    const formattedPrompt = await compactTemplate.format({
      contextHistory: limitedContext
        .filter((msg) => msg.role === "assistant" || msg.role === "user")
        .map((msg) => msg.message)
        .join("\n"),
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    content = response.content as string;
    const usage =
      (response as any).usage_metadata || (response as any).metadata?.usage;
    await emitEvent({ type: "compact", message: "Context compacted" });

    // Return the latest 3 context entries along with the new compacted context
    return {
      context: [{ role: "assistant", message: content }, ...context.slice(-3)],
      usage,
    };
  } catch (error) {
    await emitEvent({
      type: "error",
      message: `Compact error: ${(error as Error).message}. Full response: ${content}`,
    });
    throw error;
  }
}

export function compactPromptTemplate() {
  const templateString = `You are a summarization agent tasked with compacting the context of a ReAct (Reasoning and Acting) agent.
  
Your goal is to summarize the provided context, attempting to preserve the most important parts of the context history.

Instructions:
1. Review the provided context history.
2. Summarize the context, focusing on preserving key information and recent steps.
3. Ensure that the most recent parts of the context remain intact.

You do not need to include any XML tags such as <thought>, <action>, or <observation> in your response, those will be added automatically by the Agent Workflow.

Here is the context history to be compacted:

<context-history>
{contextHistory}
</context-history>

Provide a compacted version of the context history, preserving important details and recent steps.
`;

  const prompt = new PromptTemplate({
    template: templateString,
    inputVariables: ["contextHistory"],
  });

  return prompt;
}
