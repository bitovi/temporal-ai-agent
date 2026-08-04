import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { trace, type Tracer } from "@opentelemetry/api";

export const SERVICE_NAME = "temporal-ai-agent";

let _sdk: NodeSDK | undefined;
let _exporter: OTLPTraceExporter | undefined;
let _resource: Resource | undefined;

export function initTelemetry(): void {
  if (_sdk) return;

  _resource = new Resource({ [ATTR_SERVICE_NAME]: SERVICE_NAME });

  _exporter = new OTLPTraceExporter({
    url: `${process.env.AXIOM_URL ?? "https://api.axiom.co"}/v1/traces`,
    headers: {
      Authorization: `Bearer ${process.env.AXIOM_API_TOKEN ?? ""}`,
      "X-Axiom-Dataset": process.env.AXIOM_DATASET ?? "temporal-ai-agent",
    },
  });

  _sdk = new NodeSDK({
    resource: _resource,
    traceExporter: _exporter,
  });

  _sdk.start();
}

/** Returns the OTLP exporter — used by Temporal's workflow span sink. */
export function getExporter(): OTLPTraceExporter {
  if (!_exporter) throw new Error("Call initTelemetry() before getExporter()");
  return _exporter;
}

/** Returns the Resource — used by Temporal's workflow span sink. */
export function getResource(): Resource {
  if (!_resource) throw new Error("Call initTelemetry() before getResource()");
  return _resource;
}

export async function shutdownTelemetry(): Promise<void> {
  await _sdk?.shutdown();
}

export function getTracer(scope: string = SERVICE_NAME): Tracer {
  return trace.getTracer(scope);
}
