import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../config/app-config.service';
import { evaluateOrigin } from './origin-policy';
import { SESSION_COOKIE } from './session-cookie-name';

/** Guard global: recusa escrita vinda de origem fora de ALLOWED_ORIGINS (CSRF). */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigins: readonly string[];

  constructor(config: AppConfigService) {
    this.allowedOrigins = config.get({ key: 'ALLOWED_ORIGINS' });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    const verdict = evaluateOrigin({
      method: request.method,
      origin: request.headers.origin,
      hasSessionCookie: Boolean(cookies?.[SESSION_COOKIE]),
      allowedOrigins: this.allowedOrigins,
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
