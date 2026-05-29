export type WorkflowMessage =
  | {
      role: "assistant";
      message: string;
    }
  | {
      role: "user";
      message: string;
      date: string;
      name: string;
    };
