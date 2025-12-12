import * as z from "zod";
import { StructuredTool, tool } from "langchain";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { Config } from "./config";

function braveSearch(): StructuredTool {
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
        options
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
    }
  );
}

function fetchWebpage(): StructuredTool {
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
    }
  );
}

export async function enumerateMCPTools(): Promise<StructuredTool[]> {
  // TODO: Make this configurable to add other MCP servers
  // const client = new MultiServerMCPClient({
  //   lifeforce: {
  //     transport: "sse",
  //     url: "https://api.repkam09.com/api/mcp",
  //     headers: {
  //       Authorization: `Bearer ${Config.LIFEFORCE_MCP_API_KEY}`,
  //     },
  //   },
  // });
  // const tools = await client.getTools();
  // return tools;

  return [];
}

export async function fetchStructuredTools(): Promise<StructuredTool[]> {
  const additional = await enumerateMCPTools();
  const result = [fetchWebpage(), braveSearch(), ...additional];

  console.log("Available tools:", result.length);

  return result;
}

export async function fetchStructuredToolsAsString(): Promise<string> {
  const promise = await fetchStructuredTools();

  const tools = promise.map((tool) => {
    if (tool.schema instanceof z.ZodType) {
      return `<tool>
    <name>${tool.name}</name>
    <description>${tool.description}</description>
    <schema>${JSON.stringify(z.toJSONSchema(tool.schema))}</schema>
</tool>`;
    }

    return `<tool>
    <name>${tool.name}</name>
    <description>${tool.description}</description>
    <schema>${JSON.stringify(tool.schema)}</schema>
</tool>`;
  });

  // Join the tools with newlines
  const result = tools.join("\n");

  console.log("Available tools:", tools.length);

  return result;
}
