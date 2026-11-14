import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  SUPPORT_SESSION_STORE,
  type SupportSessionStore,
} from '../application/ports/support-session.store.port';
import { supportSessionExpiry } from '../domain/support-session';
import type { AuthenticatedRequest } from './authenticated-request';
import { NOT_IN_SUPPORT_SESSION } from './not-in-support-session.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type RoutedRequest = Omit<AuthenticatedRequest, 'route'> & {
  baseUrl?: string;
  route?: { path?: string };
  support?: { supportSessionId: string; weddingId: string; staffUserId: string };
};

/** As rotas que o staff usa durante o Ver como o casal fora das do casamento. */
function isStaffRoute(path: string, method: string): boolean {
  return (
    path.startsWith('/v1/admin') ||
    (path === '/v1/me' && method === 'GET') ||
    path.startsWith('/v1/auth')
  );
}

/**
 * Ver como o casal (Backoffice - acesso RN08), depois do SessionGuard: a sessão
 * de suporte termina sozinha com 30 minutos sem requisição ou no teto de 2 horas
 * (`403 SUPPORT_SESSION_ENDED` com o motivo, para o Toast). Aberta, ela:
 * - só lê o casamento dela: outro casamento, `403 ACTION_NOT_ALLOWED`;
 * - não escreve em nome do casal: `POST`, `PUT`, `PATCH`, `DELETE` e o GET que
 *   grava ou leva dados para fora (o Exportar), `403 SUPPORT_READ_ONLY`;
 * - não lê o que é pessoal do dono (central, preferências, push): `403 ACTION_NOT_ALLOWED`;
 * - grava uma linha de log por requisição, com o molde da rota (B9-5).
 * O Backoffice, o `GET /v1/me` e o login/logout seguem normais.
 */
@Injectable()
export class SupportSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPPORT_SESSION_STORE) private readonly store: SupportSessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<RoutedRequest>();
    const supportSessionId = request.auth?.supportSessionId;
    if (!request.auth || !supportSessionId) return true;
    const now = new Date();
    const session = await this.store.find({ id: supportSessionId });
    if (!session || session.endedAt) return true;
    const expired = supportSessionExpiry({ session, now });
    if (expired) {
      await this.store.end({ id: session.id, reason: expired, now });
      throw new ForbiddenException({
        statusCode: 403,
        error: 'SUPPORT_SESSION_ENDED',
        message: 'The support session ended.',
        reason: expired,
      });
    }
    const route = request.route?.path
      ? `${request.baseUrl ?? ''}${request.route.path}`
      : request.path;
    const method = request.method;
    const weddingId = (request.params as Record<string, string | undefined>).weddingId;

    if (!weddingId && isStaffRoute(request.path, method)) return true;
    if (!weddingId || weddingId !== session.weddingId) throw notAllowed();
    const blockedRead = this.reflector.getAllAndOverride<boolean>(NOT_IN_SUPPORT_SESSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!READ_METHODS.has(method) || blockedRead)
      throw new ForbiddenException({
        statusCode: 403,
        error: 'SUPPORT_READ_ONLY',
        message: 'Read only while viewing as the couple.',
      });
    await this.store.touch({
      id: session.id,
      adminUserId: session.adminUserId,
      weddingId: session.weddingId,
      method,
      route,
      now,
    });
    request.support = {
      supportSessionId: session.id,
      weddingId: session.weddingId,
      staffUserId: session.adminUserId,
    };
    return true;
  }
}

function notAllowed(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: 'ACTION_NOT_ALLOWED',
    message: 'Not available while viewing as the couple.',
  });
}
