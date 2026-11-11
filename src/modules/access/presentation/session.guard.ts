import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { IS_OPTIONAL_SESSION_ROUTE, IS_PUBLIC_ROUTE } from '../../../shared/http/public.decorator';
import { AuthenticateSession } from '../application/authenticate-session.use-case';
import { toHttpError } from './access-http-errors';
import type { AuthenticatedRequest } from './authenticated-request';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './session-cookie';

/**
 * Guard global: toda rota exige sessão, salvo @Public(). Valida o cookie,
 * renova a sessão com o uso (RN08) e deixa a sessão em request.auth.
 *
 * Pedido vindo da origem do site do casal ignora a sessão (Site público RN07,
 * defesa extra): o cookie vai junto porque os dois hosts são o mesmo site, mas
 * o site nunca age como o casal.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  private readonly siteOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly authenticate: AuthenticateSession,
    config: AppConfigService,
  ) {
    this.siteOrigin = config.siteOrigin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const optional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_SESSION_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic && !optional) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const cookies = request.cookies as Record<string, string | undefined>;
    const fromSite = request.headers.origin === this.siteOrigin;
    const token = fromSite ? undefined : cookies[SESSION_COOKIE];
    if (optional && !token) return true;

    try {
      const { session, renewedUntil } = await this.authenticate.execute({ token, now: new Date() });
      if (token && renewedUntil) setSessionCookie({ response, token, expiresAt: renewedUntil });
      request.auth = session;
      return true;
    } catch (error) {
      if (token) clearSessionCookie({ response });
      if (optional) return true;
      throw toHttpError(error);
    }
  }
}
