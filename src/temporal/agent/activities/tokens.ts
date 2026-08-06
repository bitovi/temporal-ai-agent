import { Config } from "../../../config";
import { estimateTokenCount } from "../provider";
import { WorkflowMessage } from "../types";

export async function tokens(
  context: WorkflowMessage[],
): Promise<{ current: number; limit: number }> {
  const count = estimateTokenCount(
    context
      .filter((msg) => msg.role === "assistant" || msg.role === "user")
      .map((msg) => msg.message)
      .join("\n"),
  );
  return { current: count, limit: Config.MAX_CONTEXT_TOKENS };
}
