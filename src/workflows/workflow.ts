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

const {
  thoughtEntity,
  actionEntity,
  observationEntity,
  compactEntity,
  persistEntity,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
  retry: {
    backoffCoefficient: 1,
    initialInterval: "3 seconds",
    maximumAttempts: 5,
  },
});

export type AgentEntityWorkflowInput = {
  continueAsNew?: {
    context: string[];
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
  "agentEntityWorkflowExit"
);

export async function agentEntityWorkflow(
  input: AgentEntityWorkflowInput
): Promise<{ usage: UsageMetadata }> {
  const context: string[] = input.continueAsNew
    ? input.continueAsNew.context
    : [];
  const usage: UsageMetadata[] = input.continueAsNew
    ? input.continueAsNew.usage
    : [];

  const pending: AgentEntityWorkflowMessagePayload[] = input.continueAsNew
    ? input.continueAsNew.pending
    : [];

  let userRequestedExit = false;

  setHandler(
    agentEntityWorkflowMessageSignal,
    (payload: AgentEntityWorkflowMessagePayload) => {
      pending.push(payload);
    }
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
        }
      );
      return { usage: finalUsage };
    }

    while (pending.length > 0) {
      const persist = pending.map(({ date, message, name }) => ({
        role: "user" as const,
        message,
        date,
        name,
      }));
      await persistEntity(persist);

      const message = pending.shift()!;
      context.push(
        `<user_message name="${message.name}" date="${message.date}">\n${message.message}\n</user_message>`
      );
    }

    const agentThought = await thoughtEntity(context);

    if (agentThought.usage) {
      usage.push(agentThought.usage);
    }

    if (agentThought.__type === "answer") {
      await persistEntity([
        { role: "assistant" as const, message: agentThought.answer },
      ]);

      context.push(`<answer>\n${agentThought.answer}\n</answer>`);

      // Wait for the next message or exit signal
      await condition(() => pending.length > 0 || userRequestedExit);
    }

    if (agentThought.__type === "action") {
      context.push(`<thought>\n${agentThought.thought}\n</thought>`);

      context.push(
        `<action><reason>\n${agentThought.action.reason}\n</reason><name>${agentThought.action.name}</name><input>${JSON.stringify(agentThought.action.input)}</input></action>`
      );

      const agentAction = await actionEntity(
        agentThought.action.name,
        agentThought.action.input
      );

      const agentObservation = await observationEntity(context, agentAction);

      if (agentObservation.usage) {
        usage.push(agentObservation.usage);
      }

      context.push(
        `<observation>\n${agentObservation.observations}\n</observation>`
      );

      if (workflowInfo().continueAsNewSuggested) {
        const compactContext = await compactEntity(context);
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
