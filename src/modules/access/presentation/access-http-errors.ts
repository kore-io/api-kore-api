import { UnauthorizedException } from '@nestjs/common';
import { SessionExpiredError } from '../domain/access.errors';

/** Erros de regra no formato nativo, com o código no campo error (decisão 99). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof SessionExpiredError) {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'SESSION_EXPIRED',
      message: 'Session expired or ended.',
    });
  }
  return error;
}
