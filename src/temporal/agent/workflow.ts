import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  WorkflowStream,
  type WorkflowStreamState,
} from "@temporalio/workflow-streams/workflow";

import type * as activities from "./activities";
import { UsageMetadata } from "@langchain/core/messages";
import { WorkflowMessage } from "./types";
import { STREAM_TOPIC, type StatusEvent } from "./stream-topics";

const { completion, action, compact, persist, tokens } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "10 minute",
  heartbeatTimeout: "30 seconds",
  retry: {
    backoffCoefficient: 1,
    initialInterval: "3 seconds",
    maximumAttempts: 5,
  },
});

export type AgentEntityWorkflowInput = {
  streamState?: WorkflowStreamState;
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

// Sent by an SSE subscriber once it has received a response's `close` terminator.
export const subscriberAcknowledgedTerminator = defineSignal(
  "subscriberAcknowledgedTerminator",
);

export async function agentEntityWorkflow(
  input: AgentEntityWorkflowInput,
): Promise<{ usage: UsageMetadata }> {
  const stream = new WorkflowStream(input.streamState);
  const status = stream.topic<StatusEvent>(STREAM_TOPIC.status);

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

  // Starts true so an immediate exit with no prior response returns without waiting.
  let subscriberDone = true;

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

  setHandler(subscriberAcknowledgedTerminator, () => {
    subscriberDone = true;
  });

  // Wait for the first message to arrive
  await condition(() => pending.length > 0 || userRequestedExit);

  while (true) {
    if (userRequestedExit) {
      // Give an in-flight subscriber poll a chance to fetch the final `close`
      // terminator before the Workflow returns. Falls through on timeout.
      await condition(() => subscriberDone, "10 seconds");

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

    // A new response is about to stream; require a fresh subscriber ack.
    subscriberDone = false;
    status.publish({ label: "Thinking\u2026" });
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
      const toolNames = agentThought.tool.map((t) => t.name).join(", ");
      status.publish({ label: `Running ${toolNames}\u2026` });

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
      status.publish({ label: "Thinking\u2026" });

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

        // Drains subscribers/pollers and carries the stream log to the next run
        // so subscribers don't see a gap across the rollover.
        await stream.continueAsNew<typeof agentEntityWorkflow>((state) => [
          {
            streamState: state,
            continueAsNew: {
              context: compactContext.context,
              usage,
              pending,
            },
          },
        ]);
      }
    }
  }
}
