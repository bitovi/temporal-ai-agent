import * as z from "zod";
import { StructuredTool, tool } from "langchain";

export function fetchWebpage(): StructuredTool {
  return tool(
    async (input: { url: string }) => {
      const response = await fetch(input.url);
      const text = await response.text();
      return text;
    },
    {
      name: "fetch_webpage",
      description:
        "Fetch the content of a webpage given its URL. Uses a simple GET request with node `fetch`. No JavaScript execution.",
      schema: z.object({
        url: z.string().describe("The URL of the webpage to fetch."),
      }),
    },
  );
}
