import { WorkflowInterceptorsFactory } from "@temporalio/workflow";
import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
} from "@temporalio/interceptors-opentelemetry/lib/workflow";

// This module is bundled into the Temporal workflow sandbox.
// It must only import from @temporalio/workflow and the
// workflow-compatible subpath of @temporalio/interceptors-opentelemetry.
export const interceptors: WorkflowInterceptorsFactory = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
});
