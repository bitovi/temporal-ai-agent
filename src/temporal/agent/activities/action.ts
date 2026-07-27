import { StructuredTool } from "@langchain/core/tools";
import { fetchStructuredTools } from "../../../tools/index";
import { estimateTokenCount } from "../provider";

export async function action(
  toolName: string,
  input: Record<string, any>,
): Promise<string> {
  const tools: StructuredTool[] = await fetchStructuredTools();
  const tool = tools.find((t) => t.name === toolName);
  if (tool) {
    try {
      const result = await tool.invoke(input);

      const tokens = estimateTokenCount(result);

      console.log(`Invoked tool ${toolName}, resulted in ${tokens} tokens.`);

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
