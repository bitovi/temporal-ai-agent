/**
 * Emits events to the server's event stream from worker activities.
 * Since worker and server run in separate processes, we communicate via HTTP.
 */

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

export async function emitEvent(eventData: {
  type: string;
  message: string;
  [key: string]: any;
}) {
  try {
    // Use a non-blocking fire-and-forget approach
    fetch(`${SERVER_URL}/api/emit-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventData),
    }).catch((err) => {
      // Silently fail if server is not available
      console.debug('Failed to emit event to server:', err.message);
    });
  } catch (error) {
    // Silently fail
  }
}
