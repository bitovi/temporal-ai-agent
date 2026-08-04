import { StructuredTool } from "@langchain/core/tools";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { fetchStructuredTools } from "../../../tools/index";
import { estimateTokenCount } from "../provider";

const tracer = trace.getTracer("temporal-ai-agent");

export async function action(
  toolName: string,
  input: Record<string, any>,
): Promise<string> {
  const span = tracer.startSpan(`tool.${toolName}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      "tool.name": toolName,
      "tool.input": JSON.stringify(input),
    },
  });

  try {
    const tools: StructuredTool[] = await fetchStructuredTools();
    const tool = tools.find((t) => t.name === toolName);
    if (tool) {
      try {
        const result = await tool.invoke(input);

        const tokens = estimateTokenCount(result);
        console.log(`Invoked tool ${toolName}, resulted in ${tokens} tokens.`);
        span.setAttributes({
          "tool.output_tokens": tokens,
          "tool.found": true,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return result as string;
      } catch (err: unknown) {
        console.error(`Error invoking tool ${toolName}:`, err);
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (err as Error).message,
        });

        const error = err as Error;
        return JSON.stringify({
          name: toolName,
          input: input,
          error: `Error invoking tool ${tool.name}: ${error.message}`,
        });
      }
    }

    console.warn(`Tool with name ${toolName} not found.`);
    span.setAttributes({ "tool.found": false });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: `Tool ${toolName} not found`,
    });
    return JSON.stringify({
      name: toolName,
      input: input,
      error: `Tool with name ${toolName} not found.`,
    });
  } finally {
    span.end();
  }
}
