import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { AllowListSpanProcessor } from './allow-list-span-processor';
import type { OtelExporter } from './otel-exporters';

/** service.name é o nome do repositório (ADR de observabilidade, item 2). */
export const SERVICE_NAME = 'api-kore-api';

/**
 * Liga o OpenTelemetry. No local o exportador é o console; o SigNoz (OTLP)
 * entra com a infraestrutura. Precisa rodar antes de qualquer import do Nest,
 * do pg e do ioredis, para a auto-instrumentação conseguir envolvê-los.
 */
export function startTelemetry({
  exporter,
  environment,
}: {
  exporter: OtelExporter;
  environment: string;
}): NodeSDK | undefined {
  if (exporter === 'none') return undefined;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      'deployment.environment.name': environment,
    }),
    spanProcessors: [
      new AllowListSpanProcessor(new SimpleSpanProcessor({ exporter: new ConsoleSpanExporter() })),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // O traceId entra no log pelo mixin do pino (logger.options.ts), e os
        // logs não são enviados pelo OpenTelemetry.
        '@opentelemetry/instrumentation-pino': { enabled: false },
      }),
    ],
  });
  sdk.start();
  return sdk;
}
