import dotenv from "dotenv";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
  makeWorkflowExporter,
  OpenTelemetryActivityInboundInterceptor,
} from "@temporalio/interceptors-opentelemetry";
import * as activities from "./temporal/agent/activities";
import { Config } from "./config";
import {
  initTelemetry,
  getExporter,
  getResource,
  shutdownTelemetry,
} from "./telemetry";

dotenv.config();

export async function createAgentWorker() {
  initTelemetry();

  const connection = await NativeConnection.connect(
    Config.TEMPORAL_CLIENT_OPTIONS,
  );

  const worker = await Worker.create({
    connection,
    namespace: Config.TEMPORAL_NAMESPACE,
    taskQueue: Config.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("./temporal/agent/workflow"),
    activities,
    sinks: {
      exporter: makeWorkflowExporter(getExporter(), getResource()),
    },
    interceptors: {
      workflowModules: [require.resolve("./temporal/agent/otel-interceptor")],
      activity: [
        (ctx) => ({
          inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
        }),
      ],
    },
  });

  return worker;
}

export async function startWorker() {
  console.log("Initializing Temporal worker...");

  const worker = await createAgentWorker();

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
    shutdownTelemetry().finally(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, shutting down worker gracefully...");
    shutdownTelemetry().finally(() => process.exit(0));
  });

  // Start the worker
  main().catch((error) => {
    console.error("Unexpected error starting worker:", error);
    process.exit(1);
  });
}
