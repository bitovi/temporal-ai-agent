import express from 'express';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { Connection, Client } from '@temporalio/client';
import dotenv from 'dotenv';
import { Config } from './internals/config';
import { agentEntityWorkflow, agentEntityWorkflowMessageSignal, agentEntityWorkflowExitSignal } from './workflows/workflows';

dotenv.config();

export const eventEmitter = new EventEmitter();

const app = express();
app.use(express.json());

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

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Agent Entity Workflow</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
  .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  input, select, button { padding: 8px 12px; margin: 5px 0; font-size: 14px; }
  select, input[type="text"] { width: 100%; box-sizing: border-box; }
  button { background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: #0056b3; }
  button.danger { background: #dc3545; }
  button.danger:hover { background: #c82333; }
  #events { margin-top: 20px; padding: 10px; background: #f9f9f9; border-left: 3px solid #007bff; max-height: 300px; overflow-y: auto; }
  .event { padding: 8px; margin: 5px 0; background: white; border-radius: 3px; font-size: 13px; }
  .event.error { background: #ffe6e6; color: #c00; }
  .event.answer { background: #e6f3ff; }
  .status { padding: 10px; margin: 10px 0; border-radius: 4px; background: #e8f5e9; }
</style>
</head>
<body>
<div class="container">
  <h1>Agent Entity Workflow</h1>
  <div class="status" id="status">Connecting...</div>
  
  <div>
    <label><strong>Conversation:</strong></label>
    <select id="conversationSelect" onchange="switchConversation()">
      <option value="">Select or create conversation</option>
    </select>
    <button onclick="createConversation()" style="width: 100%; margin-top: 8px;">New Conversation</button>
  </div>

  <div id="messagePanel" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd;">
    <div>
      <label><strong>Name:</strong></label>
      <input type="text" id="nameInput" placeholder="Your name" value="user@example.com">
    </div>
    
    <div>
      <label><strong>Message:</strong></label>
      <input type="text" id="messageInput" placeholder="Type your message..." onkeypress="if(event.key==='Enter') sendMessage()">
    </div>
    
    <div>
      <button onclick="sendMessage()" style="width: 48%; margin-right: 2%;">Send Message</button>
      <button onclick="exitConversation()" class="danger" style="width: 48%;">Exit</button>
    </div>
  </div>

  <div id="events"></div>
</div>

<script>
let currentConversationId = null;
const eventSource = new EventSource('/events');

eventSource.onopen = function() {
  document.getElementById('status').textContent = '✓ Connected to event stream';
};

eventSource.onerror = function(e) {
  document.getElementById('status').textContent = '✗ Error connecting to event stream';
};

eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  const div = document.createElement('div');
  div.className = 'event';
  if (data.type === 'error') div.className += ' error';
  if (data.type === 'answer') div.className += ' answer';
  div.textContent = \`[\${data.type.toUpperCase()}] \${data.message}\`;
  document.getElementById('events').appendChild(div);
  document.getElementById('events').scrollTop = document.getElementById('events').scrollHeight;
};

async function createConversation() {
  const res = await fetch('/api/conversations', { method: 'POST' });
  const data = await res.json();
  currentConversationId = data.conversationId;
  updateConversationSelect();
  document.getElementById('messagePanel').style.display = 'block';
  document.getElementById('events').innerHTML = '';
}

async function updateConversationSelect() {
  const res = await fetch('/api/conversations');
  const data = await res.json();
  const select = document.getElementById('conversationSelect');
  select.innerHTML = '<option value="">Select conversation</option>';
  data.conversations.forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.substring(0, 8) + '...';
    select.appendChild(option);
  });
  if (currentConversationId) {
    select.value = currentConversationId;
  }
}

function switchConversation() {
  const select = document.getElementById('conversationSelect');
  currentConversationId = select.value;
  if (currentConversationId) {
    document.getElementById('messagePanel').style.display = 'block';
    document.getElementById('events').innerHTML = '';
  } else {
    document.getElementById('messagePanel').style.display = 'none';
  }
}

async function sendMessage() {
  if (!currentConversationId) {
    alert('Please select or create a conversation');
    return;
  }
  
  const name = document.getElementById('nameInput').value.trim();
  const message = document.getElementById('messageInput').value.trim();
  
  if (!name || !message) {
    alert('Please fill in name and message');
    return;
  }

  await fetch(\`/api/conversations/\${currentConversationId}/message\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, message })
  });

  document.getElementById('messageInput').value = '';
}

async function exitConversation() {
  if (!currentConversationId) return;
  
  const res = await fetch(\`/api/conversations/\${currentConversationId}/exit\`, { method: 'POST' });
  const data = await res.json();
  
  currentConversationId = null;
  document.getElementById('messagePanel').style.display = 'none';
  updateConversationSelect();
  document.getElementById('events').innerHTML += '<div class="event" style="background: #fff3cd;">Conversation ended. Usage: ' + JSON.stringify(data.usage) + '</div>';
}

// Load conversations on startup
updateConversationSelect();
</script>
</body>
</html>
  `);
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
