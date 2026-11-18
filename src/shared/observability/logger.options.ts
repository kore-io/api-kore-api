import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppEnv } from '@/shared/config/env.schema';

interface RoutedRequest extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

/**
 * Do pedido sai só o método e o MOLDE da rota (/v1/public/parties/:linkToken),
 * nunca a URL real, a query string nem os cabeçalhos (token, cookie, e-mail).
 * Sem rota casada (o 404 cai no curinga `{/*splat}` do Nest, e nenhum
 * controller usa curinga), sai `(unmatched)`.
 */
export function serializeRequest(request: RoutedRequest | { raw: RoutedRequest }): {
  method?: string;
  route: string;
} {
  // O pino-http entrega o pedido embrulhado pelo pino-std-serializers ({ raw }).
  const raw = 'raw' in request ? request.raw : request;
  const path = raw.route?.path;
  // Sempre texto hoje (o Nest registra um caminho por rota); a guarda deixa
  // explícito, para uma rota por expressão regular não quebrar a linha do log.
  const route =
    typeof path === 'string' && path !== '' && !path.includes('*')
      ? `${raw.baseUrl ?? ''}${path}`
      : '(unmatched)';
  return { method: raw.method, route };
}

/**
 * O pino-http serializa o `req` dos loggers filhos no começo do pedido, antes
 * do roteamento, e a rota saía sempre `(unmatched)` (decisão 285). Os loggers
 * do pedido ficam só com o reqId (quietReqLogger/quietResLogger) e a linha do
 * fim leva o `req` cru, serializado ali, com a rota já casada.
 */
function withRequest<T extends object>(request: IncomingMessage, entry: T): T & { req: unknown } {
  return { req: request, ...entry };
}

export function serializeResponse(response: ServerResponse): { statusCode: number } {
  return { statusCode: response.statusCode };
}

/** Liga o log ao trace (ADR de observabilidade, item 3). */
export function traceMixin(): { traceId?: string } {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  return traceId ? { traceId } : {};
}

/** Chaves que, em qualquer objeto logado, saem como [Redacted]. */
export const REDACTED_KEYS = [
  'email',
  'phone',
  'name',
  'firstName',
  'lastName',
  'message',
  'pixKey',
  'cpf',
  'cnpj',
  // Quem paga (Publicar e pagar RN02; B2-13): o CPF inteiro e o token do cartão.
  'taxId',
  'cardToken',
  'document',
  'token',
  'password',
  'authorization',
  'cookie',
];

// O redact do pino não tem curinga recursivo: cada nível vira um caminho.
const REDACT_DEPTH = 5;

/**
 * Segunda barreira para o log da aplicação: se alguém logar um objeto com
 * dado pessoal ou segredo, até REDACT_DEPTH níveis de profundidade, o valor sai
 * como [Redacted].
 */
export const REDACTED_PATHS = REDACTED_KEYS.flatMap((key) =>
  Array.from({ length: REDACT_DEPTH }, (_, depth) =>
    [...Array<string>(depth).fill('*'), key].join('.'),
  ),
);

export function buildLoggerParams({ appEnv, level }: { appEnv: AppEnv; level: string }): Params {
  return {
    pinoHttp: {
      level,
      mixin: traceMixin,
      redact: { paths: REDACTED_PATHS },
      serializers: { req: serializeRequest, res: serializeResponse },
      quietReqLogger: true,
      quietResLogger: true,
      customSuccessObject: (request, _response, entry: object) => withRequest(request, entry),
      customErrorObject: (request, _response, _error, entry: object) => withRequest(request, entry),
      // O health é chamado a cada poucos segundos pelo host: não vira log.
      autoLogging: { ignore: (request) => request.url === '/health' },
      transport: appEnv === 'local' && isPrettyAvailable() ? { target: 'pino-pretty' } : undefined,
    },
  };
}

// pino-pretty é dependência de desenvolvimento: na imagem Docker (sem
// devDependencies) o log sai em JSON mesmo com APP_ENV=local.
function isPrettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}
