import express from 'express';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { Connection, Client } from '@temporalio/client';
import dotenv from 'dotenv';
import path from 'path';
import { Config } from './internals/config';
import { agentEntityWorkflow, agentEntityWorkflowMessageSignal, agentEntityWorkflowExitSignal } from './workflows/workflow';

dotenv.config();

export const eventEmitter = new EventEmitter();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const workflowSessions: Map<string, any> = new Map();
let connection: any;
let client: any;

// Initialize Temporal client
async function initTemporal() {
  connection = await Connection.connect(Config.TEMPORAL_CLIENT_OPTIONS);
  client = new Client({ connection, namespace: Config.TEMPORAL_NAMESPACE });
}

// POST /api/conversations - Start new conversation
app.post('/api/conversations', async (req, res) => {
  try {
    const conversationId = randomUUID();
    const handle = await client.workflow.start(agentEntityWorkflow, {
      args: [{}],
      taskQueue: Config.TEMPORAL_TASK_QUEUE,
      workflowId: `entity-workflow-${conversationId}`,
    });
    workflowSessions.set(conversationId, handle);
    res.json({ conversationId, workflowId: handle.workflowId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/conversations - List active conversations
app.get('/api/conversations', (req, res) => {
  const conversations = Array.from(workflowSessions.keys());
  res.json({ conversations });
});

// POST /api/conversations/:id/message - Send message
app.post('/api/conversations/:id/message', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, message } = req.body;

    if (!name || !message) {
      return res.status(400).json({ error: 'name and message required' });
    }

    const handle = workflowSessions.get(id);
    if (!handle) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await handle.signal(agentEntityWorkflowMessageSignal, {
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
app.post('/api/conversations/:id/exit', async (req, res) => {
  try {
    const { id } = req.params;
    const handle = workflowSessions.get(id);
    if (!handle) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    await handle.signal(agentEntityWorkflowExitSignal);
    const result = await handle.result();
    workflowSessions.delete(id);
    res.json({ success: true, usage: result.usage });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// POST /api/emit-event - Receive events from worker activities
app.post('/api/emit-event', (req, res) => {
  const eventData = req.body;
  eventEmitter.emit('bot-event', eventData);
  res.json({ success: true });
});

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  res.write(`data: ${JSON.stringify({type: 'connected', message: 'SSE connected'})}\n\n`);

  const listener = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventEmitter.on('bot-event', listener);

  req.on('close', () => {
    eventEmitter.off('bot-event', listener);
  });
});

export default app;

// If this file is run directly, start the server
if (require.main === module) {
  async function main() {
    try {
      await initTemporal();
      console.log('Temporal client initialized');

      const PORT = process.env.PORT || 3000;
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    } catch (error) {
      console.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    process.exit(0);
  });

  main().catch((error) => {
    console.error('Unexpected error starting server:', error);
    process.exit(1);
  });
}
