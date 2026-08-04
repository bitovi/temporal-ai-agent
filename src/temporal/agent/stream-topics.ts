// Shared Workflow Stream topic names and payload types.
// Keep this module dependency-free so it can be imported from the Workflow
// sandbox, Activities, and the HTTP server without pulling in heavy deps.

export const STREAM_TOPIC = {
  delta: "delta",
  retry: "retry",
  close: "close",
  status: "status",
} as const;

export interface TextDelta {
  text: string;
}

export interface RetryEvent {
  attempt: number;
}

export type CloseEvent = Record<string, never>;

export interface StatusEvent {
  /** Short human-readable label shown in the UI, e.g. "Thinking…" or "Running brave_search". */
  label: string;
}
