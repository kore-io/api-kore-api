import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import { Writable } from 'node:stream';
import { REDACTED_PATHS, serializeRequest, traceMixin } from './logger.options';

describe('serializeRequest', () => {
  it('dado um pedido com token na URL, query e cabeçalhos, quando serializa, então só sai o método e o molde da rota', () => {
    const request = {
      method: 'GET',
      url: '/v1/public/parties/token-secreto?email=ana@kore.com.br',
      headers: { cookie: 'session=abc', authorization: 'Bearer x' },
      baseUrl: '',
      route: { path: '/v1/public/parties/:linkToken' },
    } as unknown as IncomingMessage;

    expect(serializeRequest(request)).toEqual({
      method: 'GET',
      route: '/v1/public/parties/:linkToken',
    });
  });

  it('dado um pedido sem rota casada, quando serializa, então não expõe a URL', () => {
    const request = { method: 'GET', url: '/qualquer/coisa?x=1' } as IncomingMessage;

    expect(serializeRequest(request)).toEqual({ method: 'GET', route: '(unmatched)' });
  });
});

describe('traceMixin', () => {
  const contextManager = new AsyncLocalStorageContextManager().enable();

  beforeAll(() => {
    context.setGlobalContextManager(contextManager);
  });

  afterAll(() => {
    context.disable();
  });

  it('dado um span ativo, quando loga, então o log leva o traceId', () => {
    const traceId = '0af7651916cd43dd8448eb211c80319c';
    const span = trace.wrapSpanContext({
      traceId,
      spanId: 'b7ad6b7169203331',
      traceFlags: TraceFlags.SAMPLED,
    });

    const result = context.with(trace.setSpan(context.active(), span), traceMixin);

    expect(result).toEqual({ traceId });
  });

  it('dado nenhum span ativo, quando loga, então não inventa traceId', () => {
    expect(traceMixin()).toEqual({});
  });
});

describe('REDACTED_PATHS', () => {
  it('dado um objeto com dado pessoal até 5 níveis de profundidade no log, quando loga, então o valor sai como [Redacted]', () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ redact: { paths: REDACTED_PATHS } }, stream);

    logger.info(
      {
        cpf: '123',
        guest: { email: 'ana@kore.com.br', phone: '+5511999999999' },
        wedding: { couple: { partner: { contact: { email: 'bia@kore.com.br' } } } },
      },
      'x',
    );

    const output = lines.join('');
    expect(output).not.toContain('ana@kore.com.br');
    expect(output).not.toContain('+5511999999999');
    expect(output).not.toContain('"cpf":"123"');
    expect(output).not.toContain('bia@kore.com.br');
    expect(output).toContain('[Redacted]');
  });
});
