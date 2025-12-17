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

const ThoughtResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    thought: {
      type: "string",
    },
    action: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
        },
        reason: {
          type: "string",
        },
        input: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["name", "reason", "input"],
    },
    answer: {
      type: "string",
    },
  },
  required: ["thought"],
};


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
  try {
    const promptTemplate = thoughtPromptTemplate();
    const formattedPrompt = await promptTemplate.format({
      userQuery: query,
      currentDate: new Date().toISOString().split("T")[0],
      previousSteps: context.join("\n"),
      availableActions: await fetchStructuredToolsAsString(),
    });

    const model = getChatModel("high", ThoughtResponseSchema);
    const response = await model.invoke([
      { role: "user", content: formattedPrompt },
    ]);

    const parsed = response as any;

    // Prioritize answer if both fields are present
    if (parsed.answer) {
      const result: AgentResultFinal = {
        __type: "answer",
        thought: parsed.thought,
        answer: parsed.answer,
        usage: response.usage_metadata,
      };
      eventEmitter.emit('bot-event', { type: 'thought', message: parsed.thought });
      eventEmitter.emit('bot-event', { type: 'answer', message: parsed.answer });
      return result;
    }

    if (parsed.action) {
      const result: AgentResultTool = {
        __type: "action",
        thought: parsed.thought,
        action: parsed.action,
        usage: response.usage_metadata,
      };
      eventEmitter.emit('bot-event', { type: 'thought', message: parsed.thought });
      return result;
    }

    throw new Error("Response must contain either 'answer' or 'action' field");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    eventEmitter.emit('bot-event', { type: 'error', message: `Thought error: ${errorMessage}` });
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
