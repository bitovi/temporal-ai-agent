import * as z from "zod";
import { StructuredTool, tool } from "langchain";

export function testTool(): StructuredTool {
  return tool(
    async (input: Record<string, string>) => {
      console.log(`Test Tool Executed with input:`, input);
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Simulate some processing delay
      return JSON.stringify({ test: "passed", original_input: input });
    },
    {
      name: "test_tool",
      description:
        "A test tool that returns the input that you provide. You should use this tool if the user asks you if tools are functioning correctly.",
      schema: z.object({
        example: z.string().describe("An example input string property."),
        number: z
          .number()
          .optional()
          .describe("An optional number input property."),
      }),
    },
  );
}
