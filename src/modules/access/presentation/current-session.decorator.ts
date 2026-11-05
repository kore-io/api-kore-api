import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import type { AuthenticatedRequest } from './authenticated-request';

/** A sessão validada pelo SessionGuard. Não existe em rota @Public(). */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedSession => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new InternalServerErrorException('Rota sem SessionGuard.');
    return request.auth;
  },
);
