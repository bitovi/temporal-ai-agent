import {
  compactPromptTemplate,
  observationPromptTemplate,
  thoughtPromptTemplate,
} from "./prompts";
import {
  fetchStructuredTools,
  fetchStructuredToolsAsString,
} from "../../internals/tools";
import { StructuredTool } from "langchain";
import { getChatModel } from "../../internals/model";
import { UsageMetadata } from "@langchain/core/messages";

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
  const promptTemplate = thoughtPromptTemplate();
  const formattedPrompt = await promptTemplate.format({
    currentDate: new Date().toISOString().split("T")[0],
    previousSteps: context.join("\n"),
    availableActions: await fetchStructuredToolsAsString(),
  });

  const model = getChatModel("high");
  const response = await model.invoke([
    { role: "user", content: formattedPrompt },
  ]);

  const parsed = JSON.parse(response.content as string);

  if (parsed.hasOwnProperty("answer")) {
    parsed.__type = "answer";
    parsed.usage = response.usage_metadata;
  }

  if (parsed.hasOwnProperty("action")) {
    parsed.__type = "action";
    parsed.usage = response.usage_metadata;
  }

  if (!parsed.hasOwnProperty("__type")) {
    throw new Error("Parsed agent result does not have a valid __type");
  }

  return parsed as AgentResult;
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

      return result as string;
    } catch (err: unknown) {
      console.error(`Error invoking tool ${toolName}:`, err);

      const error = err as Error;
      return JSON.stringify({
        name: toolName,
        input: input,
        error: `Error invoking tool ${tool.name}: ${error.message}`,
      });
    }
  }

  console.warn(`Tool with name ${toolName} not found.`);

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
  const promptTemplate = observationPromptTemplate();
  const formattedPrompt = await promptTemplate.format({
    previousSteps: context.join("\n"),
    actionResult: actionResult,
  });

  const model = getChatModel("low");
  const response = await model.invoke([
    { role: "user", content: formattedPrompt },
  ]);
  return {
    observations: response.content as string,
    usage: response.usage_metadata,
  };
}

export async function compactEntity(
  context: string[]
): Promise<CompactionResult> {
  const compactTemplate = compactPromptTemplate();
  const formattedPrompt = await compactTemplate.format({
    contextHistory: context.join("\n"),
  });

  const model = getChatModel("low");
  const response = await model.invoke([
    { role: "user", content: formattedPrompt },
  ]);

  // Return the latest 3 context entries along with the new compacted context
  return {
    context: [response.content as string, ...context.slice(-3)],
    usage: response.usage_metadata,
  };
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
