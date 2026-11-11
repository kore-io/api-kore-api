import { SetMetadata, type ExecutionContext } from '@nestjs/common';

/** Janela dos limites por IP (ADR do rate limit; decisão 135, Q4). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

export const GENERAL_THROTTLER = 'general';
export const AUTH_THROTTLER = 'auth';

const AUTH_RATE_LIMITED = 'authRateLimited';

/**
 * Rota de autenticação (pedir código, confirmar código, voltar do Google):
 * além do limite geral, entra no limite de auth, somado entre essas rotas.
 */
export const AuthRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTH_RATE_LIMITED, true);

export function isAuthRateLimited(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getHandler()) === true ||
    Reflect.getMetadata(AUTH_RATE_LIMITED, context.getClass()) === true
  );
}

/**
 * Importação de convidados (decisões 186, item 16, e 189, item 3): 20 pedidos
 * por minuto por usuário, somados entre as duas prévias e as duas confirmações.
 * O tracker é o userId da sessão; por isso o limite é um guard da rota, que
 * roda depois da sessão, e não um throttler do guard global (que roda antes).
 */
export const GUEST_IMPORT_THROTTLER = 'guest_import';
export const GUEST_IMPORT_PER_MINUTE = 20;
