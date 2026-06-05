export type WorkflowMessage =
  | WorkflowMessageAssistant
  | WorkflowMessageUser
  | WorkflowMessageToolCall
  | WorkflowMessageToolResult;

export type WorkflowMessageAssistant = {
  role: "assistant";
  message: string;
};

export type WorkflowMessageUser = {
  role: "user";
  message: string;
  date: string;
  name: string;
};

export type WorkflowMessageToolCall = {
  role: "tool_call";
  name: string;
  input: Record<string, unknown>;
  id: string;
};

export type WorkflowMessageToolResult = {
  role: "tool_result";
  name: string;
  output: string;
  id: string;
};
