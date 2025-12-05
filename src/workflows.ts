import {
  continueAsNew,
  proxyActivities,
  workflowInfo,
} from "@temporalio/workflow";
import type * as activities from "./activities";
import { UsageMetadata } from "@langchain/core/messages";

const { thought, action, observation, compact } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "1 minute",
  retry: {
    backoffCoefficient: 1,
    initialInterval: "3 seconds",
    maximumAttempts: 5,
  },
});

export type AgentWorkflowInput = {
  query: string;
  continueAsNew?: {
    context: string[];
    usage: UsageMetadata[];
  };
};

export async function agentWorkflow(
  input: AgentWorkflowInput,
): Promise<{ answer: string; usage: UsageMetadata }> {
  const context: string[] = input.continueAsNew
    ? input.continueAsNew.context
    : [];
  const usage: UsageMetadata[] = input.continueAsNew
    ? input.continueAsNew.usage
    : [];

  while (true) {
    const agentThought = await thought(input.query, context);

    if (agentThought.usage) {
      usage.push(agentThought.usage);
    }

    if (agentThought.__type === "answer") {
      // Calculate the final usage metrics based on the collected metadata
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

      return { answer: agentThought.answer, usage: finalUsage };
    }

    context.push(`<thought>\n${agentThought.thought}\n</thought>`);

    context.push(
      `<action><reason>\n${agentThought.action.reason}\n</reason><name>${agentThought.action.name}</name><input>${JSON.stringify(agentThought.action.input)}</input></action>`,
    );

    const agentAction = await action(
      agentThought.action.name,
      agentThought.action.input,
    );

    const agentObservation = await observation(
      input.query,
      context,
      agentAction,
    );

    if (agentObservation.usage) {
      usage.push(agentObservation.usage);
    }

    context.push(
      `<observation>\n${agentObservation.observations}\n</observation>`,
    );

    if (workflowInfo().continueAsNewSuggested) {
      const compactContext = await compact(input.query, context);
      if (compactContext.usage) {
        usage.push(compactContext.usage);
      }
      return continueAsNew<typeof agentWorkflow>({
        query: input.query,
        continueAsNew: {
          context: compactContext.context,
          usage,
        },
      });
    }
  }
}
