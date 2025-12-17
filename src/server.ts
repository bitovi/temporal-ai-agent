import express from 'express';
import { EventEmitter } from 'events';

export const eventEmitter = new EventEmitter();

const app = express();

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
<title>Bot Events</title>
</head>
<body>
<h1>Bot Activity</h1>
<div id="status">Connecting...</div>
<div id="events"></div>
<script>
const eventSource = new EventSource('/events');
eventSource.onopen = function() {
  document.getElementById('status').textContent = 'Connected';
};
eventSource.onerror = function(e) {
  document.getElementById('status').textContent = 'Error connecting to event stream';
  console.error('SSE error:', e);
};
eventSource.onmessage = function(event) {
  const data = JSON.parse(event.data);
  const div = document.createElement('div');
  div.textContent = \`\${new Date().toLocaleTimeString()}: \${data.type} - \${data.message}\`;
  document.getElementById('events').appendChild(div);
};
</script>
</body>
</html>
  `);
});

export default app;