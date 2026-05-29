import { StructuredTool } from "@langchain/core/tools";
import { fetchStructuredTools } from "../../internals/tools";
import { emitEvent } from "../../internals/event-client";

export async function action(
  toolName: string,
  input: Record<string, any>,
): Promise<string> {
  const tools: StructuredTool[] = await fetchStructuredTools();
  const tool = tools.find((t) => t.name === toolName);
  if (tool) {
    try {
      const result = await tool.invoke(input);

      console.log(`Invoked tool ${toolName}`);

      await emitEvent({
        type: "action",
        message: `Invoked tool ${toolName} with input ${JSON.stringify(input)}`,
      });

      return result as string;
    } catch (err: unknown) {
      console.error(`Error invoking tool ${toolName}:`, err);

      const error = err as Error;
      await emitEvent({
        type: "error",
        message: `Error invoking tool ${toolName}: ${error.message}`,
      });

      return JSON.stringify({
        name: toolName,
        input: input,
        error: `Error invoking tool ${tool.name}: ${error.message}`,
      });
    }
  }

  console.warn(`Tool with name ${toolName} not found.`);

  await emitEvent({
    type: "error",
    message: `Tool with name ${toolName} not found.`,
  });

  return JSON.stringify({
    name: toolName,
    input: input,
    error: `Tool with name ${toolName} not found.`,
  });
}
