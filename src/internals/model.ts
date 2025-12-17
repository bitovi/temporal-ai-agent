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
