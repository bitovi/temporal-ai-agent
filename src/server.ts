import express from "express";
import { randomUUID } from "node:crypto";
import { Connection, Client } from "@temporalio/client";
import { WorkflowStreamClient } from "@temporalio/workflow-streams/client";
import { defaultPayloadConverter } from "@temporalio/common";
import dotenv from "dotenv";
import path from "path";
import { Config } from "./config";
import {
  agentEntityWorkflow,
  agentEntityWorkflowMessageSignal,
  agentEntityWorkflowExitSignal,
  subscriberAcknowledgedTerminator,
} from "./temporal/agent/workflow";
import {
  STREAM_TOPIC,
  type TextDelta,
  type StatusEvent,
} from "./temporal/agent/stream-topics";

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

let connection: Connection;
let client: Client;

const workflowIdFor = (conversationId: string) =>
  `entity-workflow-${conversationId}`;

// Initialize Temporal client
async function initTemporal() {
  connection = await Connection.connect(Config.TEMPORAL_CLIENT_OPTIONS);
  client = new Client({ connection, namespace: Config.TEMPORAL_NAMESPACE });
}

// POST /api/conversations - Start new conversation
app.post("/api/conversations", async (req, res) => {
  try {
    const conversationId = randomUUID();
    const handle = await client.workflow.start(agentEntityWorkflow, {
      args: [{}],
      taskQueue: Config.TEMPORAL_TASK_QUEUE,
      workflowId: workflowIdFor(conversationId),
    });
    res.json({ conversationId, workflowId: handle.workflowId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/conversations - List active conversations from Temporal visibility
app.get("/api/conversations", async (req, res) => {
  try {
    const conversations: string[] = [];
    for await (const wf of client.workflow.list({
      query: `WorkflowType = 'agentEntityWorkflow' AND ExecutionStatus = 'Running'`,
    })) {
      conversations.push(wf.workflowId.replace(/^entity-workflow-/, ""));
    }
    res.json({ conversations });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/conversations/:id/message - Send message
app.post("/api/conversations/:id/message", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ error: "name and message required" });
    }

    await client.workflow
      .getHandle(workflowIdFor(id))
      .signal(agentEntityWorkflowMessageSignal, {
        name,
        message,
        date: new Date().toISOString(),
      });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/conversations/:id/exit - End conversation
app.post("/api/conversations/:id/exit", async (req, res) => {
  try {
    const { id } = req.params;
    const handle = client.workflow.getHandle(workflowIdFor(id));
    await handle.signal(agentEntityWorkflowExitSignal);
    const result = await handle.result();
    res.json({ success: true, usage: result.usage });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/conversations/:id/stream - SSE stream of the response tokens
app.get("/api/conversations/:id/stream", async (req, res) => {
  const workflowId = workflowIdFor(req.params.id);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`event: connected\ndata: {}\n\n`);

  const streamClient = WorkflowStreamClient.create(client, workflowId);

  let clientClosed = false;
  req.on("close", () => {
    clientClosed = true;
  });

  try {
    for await (const item of streamClient.subscribe([
      STREAM_TOPIC.delta,
      STREAM_TOPIC.retry,
      STREAM_TOPIC.close,
      STREAM_TOPIC.status,
    ])) {
      if (clientClosed) break;

      if (item.topic === STREAM_TOPIC.delta) {
        const delta = defaultPayloadConverter.fromPayload<TextDelta>(item.data);
        res.write(`event: delta\ndata: ${JSON.stringify(delta)}\n\n`);
      } else if (item.topic === STREAM_TOPIC.retry) {
        res.write(`event: retry\ndata: {}\n\n`);
      } else if (item.topic === STREAM_TOPIC.status) {
        const ev = defaultPayloadConverter.fromPayload<StatusEvent>(item.data);
        res.write(`event: status\ndata: ${JSON.stringify(ev)}\n\n`);
      } else if (item.topic === STREAM_TOPIC.close) {
        res.write(`event: close\ndata: {}\n\n`);
        // Ack so the Workflow's exit overlap can release promptly.
        await client.workflow
          .getHandle(workflowId)
          .signal(subscriberAcknowledgedTerminator)
          .catch(() => {});
      }
    }
  } catch (error) {
    if (!clientClosed) {
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`,
      );
    }
  } finally {
    res.end();
  }
});

export default app;

// If this file is run directly, start the server
if (require.main === module) {
  async function main() {
    try {
      await initTemporal();
      console.log("Temporal client initialized");

      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    } catch (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, shutting down gracefully...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nReceived SIGTERM, shutting down gracefully...");
    process.exit(0);
  });

  main().catch((error) => {
    console.error("Unexpected error starting server:", error);
    process.exit(1);
  });
}
