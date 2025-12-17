import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Runnable } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";
import { Config } from "./config";

export const ThoughtResponseSchema = {
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

export function getChatModel(
  quality: "high" | "low",
  schema?: Record<string, any>,
): BaseChatModel | Runnable<any, any> {
  const baseModel = new ChatOpenAI({
    model:
      quality === "high"
        ? Config.OPENAI_HIGH_MODEL
        : Config.OPENAI_LOW_MODEL,
    apiKey: Config.OPENAI_API_KEY,
    streaming: false,
  });

  switch (Config.MODEL_PROVIDER) {
    case "openai": {
      if (schema) {
        return baseModel.withStructuredOutput(schema as any, { name: "response" });
      }
      return baseModel;
    }

    default: {
      throw new Error(`Unsupported model provider: ${Config.MODEL_PROVIDER}`);
    }
  }
}

export function estimateTokenCount(text: string): number {
  // For simplicity's sake, rough approximation: ~4 characters per token for English text
  return Math.ceil(text.length / 4);
}

export function truncateContextToTokenLimit(
  context: string[],
  maxTokens: number
): string[] {
  if (context.length === 0) {
    return context;
  }

  const contextText = context.join("\n");
  const totalTokens = estimateTokenCount(contextText);

  if (totalTokens <= maxTokens) {
    return context;
  }

  // Start from the end and work backwards, keeping messages until we hit the limit
  // This could be optimized further by summarizing old messages instead of truncating
  let truncatedContext: string[] = [];
  let currentTokens = 0;

  for (let i = context.length - 1; i >= 0; i--) {
    const message = context[i];
    const messageTokens = estimateTokenCount(message + "\n");
    
    if (currentTokens + messageTokens <= maxTokens) {
      truncatedContext.unshift(message);
      currentTokens += messageTokens;
    } else if (truncatedContext.length === 0) {
      // Always keep at least one message even if it exceeds the limit
      truncatedContext.unshift(message);
      break;
    } else {
      break;
    }
  }

  return truncatedContext;
}
