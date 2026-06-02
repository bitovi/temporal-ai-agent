import { StructuredTool } from "langchain";
import { fetchWebpage } from "./web";
import { braveSearch } from "./brave";
import { enumerateMCPTools } from "./mcp";
import { testTool } from "./test";

export async function fetchStructuredTools(): Promise<StructuredTool[]> {
  const additional = await enumerateMCPTools();
  const result = [fetchWebpage(), braveSearch(), testTool(), ...additional];

  console.log("Available tools:", result.length);

  return result;
}
