import { SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { AllowListSpanProcessor } from './allow-list-span-processor';

const EMAIL = 'ana@kore.com.br';

async function exportSpan({
  build,
}: {
  build: (span: ReturnType<ReturnType<TracerProvider['getTracer']>['startSpan']>) => void;
}): Promise<ReadableSpan> {
  const exporter = new InMemorySpanExporter();
  const provider = new TracerProvider({
    spanProcessors: [new AllowListSpanProcessor(new SimpleSpanProcessor({ exporter }))],
  });
  const span = provider.getTracer('test').startSpan('GET /v1/public/parties/:linkToken');
  build(span);
  span.end();
  await provider.forceFlush();
  const [exported] = exporter.getFinishedSpans();
  await provider.shutdown();
  return exported;
}

// O que o exportador lê do span (o objeto inteiro tem referências circulares).
function exportedData({ span }: { span: ReadableSpan }): string {
  const { name, attributes, events, links, status } = span;
  return JSON.stringify({ name, attributes, events, links, status });
}

describe('AllowListSpanProcessor', () => {
  it('dado um span com URL real, SQL e e-mail, quando exporta, então só saem os atributos da lista', async () => {
    const exported = await exportSpan({
      build: (span) =>
        span.setAttributes({
          'http.request.method': 'GET',
          'http.route': '/v1/public/parties/:linkToken',
          'http.response.status_code': 200,
          'url.full': `https://api.kore.com.br/v1/public/parties/token-secreto?email=${EMAIL}`,
          'db.query.text': `SELECT * FROM guests WHERE email = '${EMAIL}'`,
          'user_agent.original': 'Mozilla/5.0',
          'client.address': '200.1.2.3',
          'app.wedding_id': '0190f3a0-0000-7000-8000-000000000000',
        }),
    });

    expect(exported.attributes).toEqual({
      'http.request.method': 'GET',
      'http.route': '/v1/public/parties/:linkToken',
      'http.response.status_code': 200,
      'app.wedding_id': '0190f3a0-0000-7000-8000-000000000000',
    });
    expect(exported.name).toBe('GET /v1/public/parties/:linkToken');
  });

  it('dado um recordException com e-mail na mensagem, quando exporta, então o evento leva só o tipo do erro', async () => {
    const error = new TypeError(`Unique constraint failed: ${EMAIL}`);

    const exported = await exportSpan({ build: (span) => span.recordException(error) });

    expect(exported.events).toHaveLength(1);
    expect(exported.events[0].name).toBe('exception');
    expect(exported.events[0].attributes).toEqual({ 'exception.type': 'TypeError' });
    expect(exportedData({ span: exported })).not.toContain(EMAIL);
  });

  it('dado um evento com atributos pessoais, quando exporta, então o evento sai sem eles e com o nome fora da lista trocado', async () => {
    const exported = await exportSpan({
      build: (span) => span.addEvent('guest.loaded', { 'guest.email': EMAIL, 'http.route': '/x' }),
    });

    expect(exported.events[0].attributes).toEqual({});
    expect(exported.events[0].name).toBe('[redacted]');
    expect(exportedData({ span: exported })).not.toContain(EMAIL);
  });

  it('dado um evento com dado pessoal no nome, quando exporta, então o nome sai como [redacted]', async () => {
    const exported = await exportSpan({
      build: (span) => span.addEvent(`convite enviado a ${EMAIL}`),
    });

    expect(exported.events[0].name).toBe('[redacted]');
    expect(exportedData({ span: exported })).not.toContain(EMAIL);
  });

  it('dado um status de erro com mensagem, quando exporta, então mantém o código e descarta a mensagem', async () => {
    const exported = await exportSpan({
      build: (span) =>
        span.setStatus({ code: SpanStatusCode.ERROR, message: `falhou para ${EMAIL}` }),
    });

    expect(exported.status).toEqual({ code: SpanStatusCode.ERROR });
  });
});
