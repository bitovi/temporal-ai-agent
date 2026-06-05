import {
  allHandlersFinished,
  condition,
  continueAsNew,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import { UsageMetadata } from "@langchain/core/messages";
import { WorkflowMessage } from "./types";

const { completion, action, compact, persist, tokens } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "10 minute",
  retry: {
    backoffCoefficient: 1,
    initialInterval: "3 seconds",
    maximumAttempts: 5,
  },
});

export type AgentEntityWorkflowInput = {
  continueAsNew?: {
    context: WorkflowMessage[];
    usage: UsageMetadata[];
    pending: AgentEntityWorkflowMessagePayload[];
  };
};

type AgentEntityWorkflowMessagePayload = {
  name: string;
  message: string;
  date: string;
};

export const agentEntityWorkflowMessageSignal = defineSignal<
  [AgentEntityWorkflowMessagePayload]
>("agentEntityWorkflowMessage");

export const agentEntityWorkflowExitSignal = defineSignal(
  "agentEntityWorkflowExit",
);

export async function agentEntityWorkflow(
  input: AgentEntityWorkflowInput,
): Promise<{ usage: UsageMetadata }> {
  const context: WorkflowMessage[] = input.continueAsNew
    ? input.continueAsNew.context
    : [];
  const usage: UsageMetadata[] = input.continueAsNew
    ? input.continueAsNew.usage
    : [];

  const pending: AgentEntityWorkflowMessagePayload[] = input.continueAsNew
    ? input.continueAsNew.pending
    : [];

  let userRequestedExit = false;

  let tools: WorkflowMessage[] = [];

  setHandler(
    agentEntityWorkflowMessageSignal,
    (payload: AgentEntityWorkflowMessagePayload) => {
      pending.push(payload);
    },
  );

  setHandler(agentEntityWorkflowExitSignal, () => {
    userRequestedExit = true;
  });

  // Wait for the first message to arrive
  await condition(() => pending.length > 0 || userRequestedExit);

  while (true) {
    if (userRequestedExit) {
      const finalUsage: UsageMetadata = usage.reduce(
        (acc, curr) => {
          acc.input_tokens += curr.input_tokens;
          acc.output_tokens += curr.output_tokens;
          acc.total_tokens += curr.total_tokens;
          return acc;
        },
        {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
        },
      );
      return { usage: finalUsage };
    }

    while (pending.length > 0) {
      const entries = pending.map(({ date, message, name }) => ({
        role: "user" as const,
        message,
        date,
        name,
      }));

      await persist(entries);

      const message = pending.shift()!;
      context.push({
        role: "user",
        message: message.message,
        name: message.name,
        date: message.date,
      });
    }

    const agentThought = await completion(context, tools);

    if (agentThought.usage) {
      usage.push(agentThought.usage);
    }

    if (agentThought.__type === "text") {
      tools = [];

      await persist([
        { role: "assistant" as const, message: agentThought.text },
      ]);

      context.push({
        role: "assistant",
        message: agentThought.text,
      });

      // Wait for the next message or exit signal
      await condition(() => pending.length > 0 || userRequestedExit);
    }

    if (agentThought.__type === "tool") {
      const actions: Promise<{
        name: string;
        input: any;
        id: string;
        output: string;
      }>[] = agentThought.tool.map(async (tool) => {
        const agentAction = await action(tool.name, tool.input);
        return {
          name: tool.name,
          input: tool.input,
          id: tool.id,
          output: agentAction,
        };
      });

      const actionResults = await Promise.all(actions);

      actionResults.forEach((entry) => {
        tools.push({
          role: "tool_call",
          id: entry.id,
          input: entry.input,
          name: entry.name,
        });

        tools.push({
          role: "tool_result",
          id: entry.id,
          name: entry.name,
          output: entry.output,
        });
      });

      // Check if we need to compact the context due to length
      const results = await tokens(context);

      if (
        workflowInfo().continueAsNewSuggested ||
        results.current > results.limit
      ) {
        const compactContext = await compact(context);
        if (compactContext.usage) {
          usage.push(compactContext.usage);
        }

        await condition(() => allHandlersFinished());

        return continueAsNew<typeof agentEntityWorkflow>({
          continueAsNew: {
            context: compactContext.context,
            usage,
            pending,
          },
        });
      }
    }
  }
}
