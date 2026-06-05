import dotenv from "dotenv";
import {
  createSdkMcpServer,
  PreToolUseHookInput,
  query,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { Config } from "../config";
import z from "zod";

dotenv.config();

function BraveWebSearchTool() {
  return tool(
    "search_web",
    "Search the web using the Brave Search API",
    {
      q: z.string().describe("The search query string."),
      count: z
        .number()
        .optional()
        .describe("Number of results to return. Defaults to 10."),
    },
    async (input) => {
      const params = new URLSearchParams();
      if (input.count !== undefined) {
        params.append("count", input.count.toString());
      }

      if (input.q !== undefined) {
        params.append("q", input.q);
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );
}

async function SearchLoggingHook(
  input: unknown,
  toolUseID: string | undefined,
) {
  // Cast input to the specific hook type for type safety
  const preInput = input as PreToolUseHookInput;

  console.log(
    `PreToolUseHook called for toolUseID: ${toolUseID}, input: ${JSON.stringify(preInput)}`,
  );

  // Return empty object to allow the operation
  return {};
}

export async function startBugFixAgent() {
  console.log("Initializing Bug Fix Agent...");

  // Wrap the tool in an in-process MCP server
  const braveWebSearch = createSdkMcpServer({
    name: "brave",
    version: "1.0.0",
    tools: [BraveWebSearchTool()],
  });

  // Agentic loop: streams messages as Claude works
  for await (const message of query({
    prompt:
      "Can you tell me the latest news with the ISS? Use the MCP search tool.",
    options: {
      allowedTools: ["Read", "Edit", "Glob", "mcp__brave___search_web"], // Auto-approve these tools
      permissionMode: "acceptEdits", // Auto-approve file edits
      env: {
        ANTHROPIC_API_KEY: Config.ANTHROPIC_API_KEY,
      },
      mcpServers: {
        "brave:": braveWebSearch,
      },
      hooks: {
        PreToolUse: [
          { matcher: "mcp__brave___search_web", hooks: [SearchLoggingHook] },
        ],
      },
    },
  })) {
    // Print human-readable output
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        switch (block.type) {
          case "text": {
            console.log(block.text); // Claude's reasoning
            break;
          }

          case "tool_use": {
            console.log(
              `<tool>${block.name}, Input: ${JSON.stringify(block.input)}, Id: ${block.id} </tool>`,
            ); // Tool being called
            break;
          }

          case "thinking": {
            console.log(`<thinking>: ${block.thinking} </thinking>`);
            break;
          }

          default: {
            console.log(`Unknown block type: ${block.type}`);
          }
        }
      }
    } else if (message.type === "result") {
      console.log(`Done: ${message.subtype}`); // Final result
    }
  }
}

// If this file is run directly, start the Bug Fix Agent
if (require.main === module) {
  async function main() {
    try {
      console.log("Starting Bug Fix Agent...");
      await startBugFixAgent();
    } catch (error) {
      console.error("Failed to start Bug Fix Agent:", error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, shutting down Bug Fix Agent gracefully...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log(
      "\nReceived SIGTERM, shutting down Bug Fix Agent gracefully...",
    );
    process.exit(0);
  });

  // Start the worker
  main().catch((error) => {
    console.error("Unexpected error starting Bug Fix Agent:", error);
    process.exit(1);
  });
}
