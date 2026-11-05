// Primeiro import do main.ts: liga o OpenTelemetry antes de o Nest carregar.
import { OTEL_EXPORTERS, OtelExporter } from './shared/observability/otel-exporters';
import { startTelemetry } from './shared/observability/telemetry';

// A validação completa do env roda depois, no ConfigModule; aqui só o mínimo
// para decidir o exportador. No local, lê o .env (o ConfigModule lê de novo).
if (!process.env.APP_ENV) {
  try {
    process.loadEnvFile('.env');
  } catch {
    // Sem .env: segue com o ambiente do processo.
  }
}

const requested = process.env.OTEL_EXPORTER ?? 'none';
const exporter: OtelExporter = (OTEL_EXPORTERS as readonly string[]).includes(requested)
  ? (requested as OtelExporter)
  : 'none';

const sdk = startTelemetry({ exporter, environment: process.env.APP_ENV ?? 'local' });

process.once('SIGTERM', () => {
  void sdk?.shutdown();
});
