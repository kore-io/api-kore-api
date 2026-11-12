// Fora de telemetry.ts para a validação do env não carregar o SDK do OpenTelemetry.
export const OTEL_EXPORTERS = ['console', 'none'] as const;
export type OtelExporter = (typeof OTEL_EXPORTERS)[number];
