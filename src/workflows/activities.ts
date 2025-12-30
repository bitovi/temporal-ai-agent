import {
  compactPromptTemplate,
  observationPromptTemplate,
  thoughtPromptTemplate,
} from "./prompts";
import {
  fetchStructuredTools,
  fetchStructuredToolsAsString,
} from "../internals/tools";
import { StructuredTool } from "langchain";
import { getChatModel, ThoughtResponseSchema, truncateContextToTokenLimit } from "../internals/model";
import { UsageMetadata } from "@langchain/core/messages";
import { emitEvent } from "../internals/event-client";
import { Config } from "../internals/config";

type AgentResult = AgentResultTool | AgentResultFinal;
type AgentResultTool = {
  __type: "action";
  thought: string;
  action: {
    name: string;
    reason: string;
    input: string | object;
  };
  usage?: UsageMetadata;
};

type AgentResultFinal = {
  __type: "answer";
  thought: string;
  answer: string;
  usage?: UsageMetadata;
};

type ObservationResult = {
  observations: string;
  usage?: UsageMetadata;
};

type CompactionResult = {
  context: string[];
  usage?: UsageMetadata;
};

export async function thoughtEntity(context: string[]): Promise<AgentResult> {
  try {
    const limitedContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS
    );

    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      currentDate: new Date().toISOString().split("T")[0],
      previousSteps: limitedContext.join("\n"),
      availableActions: await fetchStructuredToolsAsString(),
    });

    const model = getChatModel("high", ThoughtResponseSchema);
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    const parsed = response as any;
    const usage = (response as any).usage_metadata || (response as any).metadata?.usage;

    if (parsed.hasOwnProperty("answer")) {
      parsed.__type = "answer";
      parsed.usage = usage;
      await emitEvent({ type: 'thought', message: parsed.thought });
      await emitEvent({ type: 'answer', message: parsed.answer });
    }

    if (parsed.hasOwnProperty("action")) {
      parsed.__type = "action";
      parsed.usage = usage;
      await emitEvent({ type: 'thought', message: parsed.thought });
    }

    if (!parsed.hasOwnProperty("__type")) {
      throw new Error("Parsed agent result does not have a valid __type");
    }

    return parsed as AgentResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await emitEvent({ type: 'error', message: `Thought error: ${errorMessage}` });
    throw error;
  }
}

export async function actionEntity(
  toolName: string,
  input: object | string
): Promise<string> {
  const tools: StructuredTool[] = await fetchStructuredTools();
  const tool = tools.find((t) => t.name === toolName);
  if (tool) {
    try {
      const result = await tool.invoke(input);

      console.log(`Invoked tool ${toolName}`);

      await emitEvent({ type: 'action', message: `Invoked tool ${toolName} with input ${JSON.stringify(input)}` });

      return result as string;
    } catch (err: unknown) {
      console.error(`Error invoking tool ${toolName}:`, err);

      const error = err as Error;
      await emitEvent({ type: 'error', message: `Error invoking tool ${toolName}: ${error.message}` });
      return JSON.stringify({
        name: toolName,
        input: input,
        error: `Error invoking tool ${tool.name}: ${error.message}`,
      });
    }
  }

  console.warn(`Tool with name ${toolName} not found.`);

  await emitEvent({ type: 'error', message: `Tool with name ${toolName} not found.` });

  return JSON.stringify({
    name: toolName,
    input: input,
    error: `Tool with name ${toolName} not found.`,
  });
}

export async function observationEntity(
  context: string[],
  actionResult: string
): Promise<ObservationResult> {
  let content = '';
  try {
    const limitedContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS
    );

    const promptTemplate = observationPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      previousSteps: limitedContext.join("\n"),
      actionResult: actionResult,
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);
    content = response.content as string;
    const usage = (response as any).usage_metadata || (response as any).metadata?.usage;
    await emitEvent({ type: 'observation', message: content });
    return {
      observations: content,
      usage,
    };
  } catch (error) {
    await emitEvent({ type: 'error', message: `Observation error: ${(error as Error).message}. Full response: ${content}` });
    throw error;
  }
}

export async function compactEntity(
  context: string[]
): Promise<CompactionResult> {
  let content = '';
  try {
    const limitedContext = truncateContextToTokenLimit(
      context,
      Config.MAX_CONTEXT_TOKENS
    );

    const compactTemplate = compactPromptTemplate();
    const formattedPrompt = await compactTemplate.format({
      contextHistory: limitedContext.join("\n"),
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    content = response.content as string;
    const usage = (response as any).usage_metadata || (response as any).metadata?.usage;
    await emitEvent({ type: 'compact', message: 'Context compacted' });

    // Return the latest 3 context entries along with the new compacted context
    return {
      context: [content, ...context.slice(-3)],
      usage,
    };
  } catch (error) {
    await emitEvent({ type: 'error', message: `Compact error: ${(error as Error).message}. Full response: ${content}` });
    throw error;
  }
}

type WorkflowMessage =
  | {
      role: "assistant";
      message: string;
    }
  | {
      role: "user";
      message: string;
      date: string;
      name: string;
    };

export async function persistEntity(
  messages: WorkflowMessage[]
): Promise<void> {
  // Implementation for persisting a message with a given role
  // This would put the message into a database or other storage system
  // For now, we just log it to the console
  for (const msg of messages) {
    if (msg.role === "user") {
      console.log(`${msg.name} (${msg.date}): ${msg.message}`);
    } else {
      console.log(`${msg.role}: ${msg.message}`);
    }
  }
}
