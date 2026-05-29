import { WorkflowMessage } from "../../types";

export async function persist(messages: WorkflowMessage[]) {
  // Implementation for persisting a message with a given role
  // This would put the message into a database or other storage system
  // For now, we just log it to the console
  for (const msg of messages) {
    if (msg.role === "user") {
      console.log(`${msg.name} (${msg.date}): ${msg.message}`);
    } else {
      console.log(`${msg.role}: ${msg.message}`);
    }
  }
}
