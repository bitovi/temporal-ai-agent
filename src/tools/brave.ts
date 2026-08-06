import * as z from "zod";
import { StructuredTool, tool } from "langchain";
import { Config } from "../config";

export function braveSearch(): StructuredTool {
  return tool(
    async (input: Record<string, string>) => {
      const params = new URLSearchParams();
      for (const key in input) {
        params.append(key, input[key]);
      }

      const options = {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "x-subscription-token": Config.BRAVE_SEARCH_API_KEY as string,
        },
      };

      const result = await fetch(
        `https://api.search.brave.com/res/v1/web/search?${params}`,
        options,
      );
      const data = await result.json();
      return JSON.stringify(data);
    },
    {
      name: "brave_search",
      description: "Search the Internet using the Brave Search Engine API.",
      schema: z.object({
        q: z.string().describe("The search query string."),
        count: z
          .number()
          .optional()
          .describe("Number of results to return. Defaults to 10."),
      }),
    },
  );
}
