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
