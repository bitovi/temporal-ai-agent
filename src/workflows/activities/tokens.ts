import { Config } from "../../internals/config";
import { estimateTokenCount } from "../../internals/model";

export async function tokens(
  context: string[],
): Promise<{ current: number; limit: number }> {
  const count = estimateTokenCount(context.join("\n"));
  return { current: count, limit: Config.MAX_CONTEXT_TOKENS };
}
