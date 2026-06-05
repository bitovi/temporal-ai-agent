import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { Connection, Client } from "@temporalio/client";
import { agentEntityWorkflow } from "../temporal/agent/workflow";
import { Config } from "../config";

dotenv.config();

async function main() {
  const connection = await Connection.connect(Config.TEMPORAL_CLIENT_OPTIONS);

  const client = new Client({
    connection,
    namespace: Config.TEMPORAL_NAMESPACE,
  });

  const workflowId = `${randomUUID()}`;

  const workflowOptions = {
    taskQueue: Config.TEMPORAL_TASK_QUEUE,
    workflowId: workflowId,
  };

  try {
    const handle = await client.workflow.start(agentEntityWorkflow, {
      args: [{}],
      ...workflowOptions,
    });

    console.log("Workflow started with ID: %s", handle.workflowId);
  } catch (error: any) {
    console.error("Error executing workflow:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
