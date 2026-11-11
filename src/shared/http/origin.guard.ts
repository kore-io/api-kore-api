import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { evaluateOrigin, originsFor } from './origin-policy';
import { hasCredentialCookie } from './session-cookie-name';
import { IS_SITE_ROUTE } from './site-route.decorator';

/**
 * Guard global: recusa escrita vinda de origem fora das da rota (CSRF). A
 * origem do site só vale nas rotas @SiteRoute() (Site público RN07).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly appOrigins: readonly string[];
  private readonly siteOrigin: string;

  constructor(
    config: AppConfigService,
    private readonly reflector: Reflector,
  ) {
    this.appOrigins = config.get({ key: 'ALLOWED_ORIGINS' });
    this.siteOrigin = config.siteOrigin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const isSiteRoute =
      this.reflector.getAllAndOverride<boolean>(IS_SITE_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    const verdict = evaluateOrigin({
      method: request.method,
      origin: request.headers.origin,
      hasCredential: hasCredentialCookie({
        cookies: request.cookies as Record<string, string | undefined> | undefined,
      }),
      allowedOrigins: originsFor({
        isSiteRoute,
        appOrigins: this.appOrigins,
        siteOrigin: this.siteOrigin,
      }),
    });
    if (verdict === 'reject') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed.',
      });
    }
    return true;
  }
}
