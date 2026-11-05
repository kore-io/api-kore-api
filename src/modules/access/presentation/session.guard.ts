import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { IS_PUBLIC_ROUTE } from '../../../shared/http/public.decorator';
import { AuthenticateSession } from '../application/authenticate-session.use-case';
import { toHttpError } from './access-http-errors';
import type { AuthenticatedRequest } from './authenticated-request';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie';

/**
 * Guard global: toda rota exige sessão, salvo @Public(). Valida o cookie,
 * renova a sessão com o uso (RN08) e deixa a sessão em request.auth.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticate: AuthenticateSession,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const cookies = request.cookies as Record<string, string | undefined>;
    const token = cookies[SESSION_COOKIE];

    try {
      const { session, renewedUntil } = await this.authenticate.execute({ token, now: new Date() });
      if (token && renewedUntil) setSessionCookie({ response, token, expiresAt: renewedUntil });
      request.auth = session;
      return true;
    } catch (error) {
      if (token) clearSessionCookie({ response });
      throw toHttpError(error);
    }
  }
}
