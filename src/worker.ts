import dotenv from "dotenv";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./workflows/activities";
import { Config } from "./internals/config";
import app from "./server";
import { eventEmitter } from "./server";

dotenv.config();

export async function createWorker() {
  const connection = await NativeConnection.connect(
    Config.TEMPORAL_CLIENT_OPTIONS,
  );

  const worker = await Worker.create({
    connection,
    namespace: Config.TEMPORAL_NAMESPACE,
    taskQueue: Config.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("./workflows/workflows"),
    activities,
  });

  return worker;
}

export async function startWorker() {
  console.log("Initializing Temporal worker...");

  const worker = await createWorker();

  console.log("Temporal worker started successfully");
  console.log(`Task queue: ${Config.TEMPORAL_TASK_QUEUE}`);
  console.log(`Namespace: ${Config.TEMPORAL_NAMESPACE}`);

  // Start the worker (this will run indefinitely)
  await worker.run();
}

// If this file is run directly, start the worker
if (require.main === module) {
  async function main() {
    try {
      console.log("Starting server...");
      app.listen(3000, () => console.log('Server running on port 3000'));
      eventEmitter.emit('bot-event', { type: 'server', message: 'Server started' });
      
      console.log("Starting Temporal worker...");
      await startWorker();
    } catch (error) {
      console.error("Failed to start worker:", error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, shutting down worker gracefully...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, shutting down worker gracefully...");
    process.exit(0);
  });

  // Start the worker
  main().catch((error) => {
    console.error("Unexpected error starting worker:", error);
    process.exit(1);
  });
}
