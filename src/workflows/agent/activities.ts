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
import { eventEmitter } from "./server";

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

export async function thought(
  query: string,
  context: string[],
): Promise<AgentResult> {
  let content = '';
  try {
    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      userQuery: query,
      currentDate: new Date().toISOString().split("T")[0],
      previousSteps: context.join("\n"),
      availableActions: await fetchStructuredToolsAsString(),
    });

    const model = getChatModel("high");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    content = response.content as string;
    content = content.trim();

    // Extract JSON from the response
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`No valid JSON found in response: ${content}`);
    }
    const jsonStr = content.substring(start, end + 1);

    const parsed = JSON.parse(jsonStr);

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

    eventEmitter.emit('bot-event', { type: 'thought', message: parsed.thought });

    return parsed as AgentResult;
  } catch (error) {
    eventEmitter.emit('bot-event', { type: 'error', message: `Thought error: ${(error as Error).message}. Full response: ${content}` });
    throw error;
  }
}

export async function action(
  toolName: string,
  input: object | string,
): Promise<string> {
  const tools: StructuredTool[] = await fetchStructuredTools();
  const tool = tools.find((t) => t.name === toolName);
  if (tool) {
    try {
      const result = await tool.invoke(input);

      console.log(`Invoked tool ${toolName}`);

      eventEmitter.emit('bot-event', { type: 'action', message: `Invoked tool ${toolName} with input ${JSON.stringify(input)}` });

      return result as string;
    } catch (err: unknown) {
      console.error(`Error invoking tool ${toolName}:`, err);

      const error = err as Error;
      eventEmitter.emit('bot-event', { type: 'error', message: `Error invoking tool ${toolName}: ${error.message}` });
      return JSON.stringify({
        name: toolName,
        input: input,
        error: `Error invoking tool ${tool.name}: ${error.message}`,
      });
    }
  }

  console.warn(`Tool with name ${toolName} not found.`);

  eventEmitter.emit('bot-event', { type: 'error', message: `Tool with name ${toolName} not found.` });

  return JSON.stringify({
    name: toolName,
    input: input,
    error: `Tool with name ${toolName} not found.`,
  });
}

export async function observation(
  query: string,
  context: string[],
  actionResult: string,
): Promise<ObservationResult> {
  let content = '';
  try {
    const promptTemplate = observationPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      userQuery: query,
      previousSteps: context.join("\n"),
      actionResult: actionResult,
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);
    content = response.content as string;
    eventEmitter.emit('bot-event', { type: 'observation', message: content });
    return {
      observations: content,
      usage: response.usage_metadata,
    };
  } catch (error) {
    eventEmitter.emit('bot-event', { type: 'error', message: `Observation error: ${(error as Error).message}. Full response: ${content}` });
    throw error;
  }
}

export async function compact(
  query: string,
  context: string[],
): Promise<CompactionResult> {
  let content = '';
  try {
    const compactTemplate = compactPromptTemplate();
    const formattedPrompt = await compactTemplate.format({
      userQuery: query,
      contextHistory: context.join("\n"),
    });

    const model = getChatModel("low");
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    content = response.content as string;
    eventEmitter.emit('bot-event', { type: 'compact', message: 'Context compacted' });

    // Return the latest 3 context entries along with the new compacted context
    return {
      context: [content, ...context.slice(-3)],
      usage: response.usage_metadata,
    };
  } catch (error) {
    eventEmitter.emit('bot-event', { type: 'error', message: `Compact error: ${(error as Error).message}. Full response: ${content}` });
    throw error;
  }
}
