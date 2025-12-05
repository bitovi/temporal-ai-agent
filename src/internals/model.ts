import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { Config } from "./config";

export function getChatModel(quality: "high" | "low"): BaseChatModel {
  switch (Config.MODEL_PROVIDER) {
    case "openai": {
      return new ChatOpenAI({
        model:
          quality === "high"
            ? Config.OPENAI_HIGH_MODEL
            : Config.OPENAI_LOW_MODEL,
        apiKey: Config.OPENAI_API_KEY,
        streaming: false,
      });
    }

    default: {
      throw new Error(`Unsupported model provider: ${Config.MODEL_PROVIDER}`);
    }
  }
}
