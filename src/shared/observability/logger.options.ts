import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { AppEnv } from '../config/env.schema';

interface RoutedRequest extends IncomingMessage {
  baseUrl?: string;
  route?: { path?: string };
}

/**
 * Do pedido sai só o método e o MOLDE da rota (/v1/public/parties/:linkToken),
 * nunca a URL real, a query string nem os cabeçalhos (token, cookie, e-mail).
 */
export function serializeRequest(request: RoutedRequest): { method?: string; route: string } {
  const route = request.route?.path
    ? `${request.baseUrl ?? ''}${request.route.path}`
    : '(unmatched)';
  return { method: request.method, route };
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
