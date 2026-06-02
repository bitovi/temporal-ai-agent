import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { encoding_for_model } from "tiktoken";
import { Config } from "./config";
import { WorkflowMessage } from "../types";
import { ChatAnthropic } from "@langchain/anthropic";

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

    case "anthropic": {
      return new ChatAnthropic({
        model:
          quality === "high"
            ? Config.ANTHROPIC_HIGH_MODEL
            : Config.ANTHROPIC_LOW_MODEL,
        apiKey: Config.ANTHROPIC_API_KEY,
        streaming: false,
      });
    }

    default: {
      throw new Error(`Unsupported model provider: ${Config.MODEL_PROVIDER}`);
    }
  }
}

export function estimateTokenCount(text: string): number {
  try {
    const encoding = encoding_for_model(Config.OPENAI_HIGH_MODEL as any);
    const tokens = encoding.encode(text);
    return tokens.length;
  } catch (error) {
    // Fallback to rough estimation if tiktoken fails
    return Math.ceil(text.length / 4);
  }
}

export function estimateWorkflowMessageTokenCount(
  messages: WorkflowMessage[],
): number {
  const text = messages
    .map((msg) => {
      if (msg.role === "assistant" || msg.role === "user") {
        return msg.message;
      }

      if (msg.role === "tool_call") {
        return "";
      }

      if (msg.role === "tool_result") {
        return msg.output;
      }

      return "";
    })
    .join("\n");

  try {
    const encoding = encoding_for_model(Config.OPENAI_HIGH_MODEL as any);
    const tokens = encoding.encode(text);
    return tokens.length;
  } catch (error) {
    // Fallback to rough estimation if tiktoken fails
    return Math.ceil(text.length / 4);
  }
}

export function truncateContextToTokenLimit(
  context: WorkflowMessage[],
  maxTokens: number,
): WorkflowMessage[] {
  if (context.length === 0) {
    return [];
  }

  const contextText = context
    .map((msg) => {
      if (msg.role === "assistant" || msg.role === "user") {
        return msg.message;
      }

      if (msg.role === "tool_call") {
        return "";
      }

      if (msg.role === "tool_result") {
        return "";
      }

      return "";
    })
    .join("\n");
  const totalTokens = estimateTokenCount(contextText);

  if (totalTokens <= maxTokens) {
    return context;
  }

  // Start from the end and work backwards, keeping messages until we hit the limit
  // This could be optimized further by summarizing old messages instead of truncating
  let truncatedContext: WorkflowMessage[] = [];
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
