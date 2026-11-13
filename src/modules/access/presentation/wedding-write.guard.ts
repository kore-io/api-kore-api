import {
  CanActivate,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  WEDDING_WRITE_STATE,
  type WeddingWriteState,
} from '../application/ports/wedding-write-state.port';
import { ALLOW_WHEN_BLOCKED } from './allow-when-blocked.decorator';
import type { AuthenticatedRequest } from './authenticated-request';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Toda escrita de um casamento bloqueado é recusada (Casamento bloqueado RN02;
 * revisão técnica B8-1): `403 WEDDING_BLOCKED`, para o casal e a colaboradora;
 * com a exclusão agendada, `409 WEDDING_DELETION_SCHEDULED` (Retenção RN05).
 * Roda depois do SessionGuard e **antes da validação do corpo**, então nenhuma
 * rota com `weddingId` escapa. A leitura, o Exportar e as exceções marcadas
 * com `@AllowWhenBlocked()` passam (RN03).
 */
@Injectable()
export class WeddingWriteGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(WEDDING_WRITE_STATE) private readonly state: WeddingWriteState,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (READ_METHODS.has(request.method)) return true;
    const weddingId = (request.params as Record<string, string | undefined>).weddingId;
    if (!weddingId || !request.auth) return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_BLOCKED, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const block = await this.state.blockOf({ userId: request.auth.userId, weddingId });
    if (block === 'blocked')
      throw new ForbiddenException({
        statusCode: 403,
        error: 'WEDDING_BLOCKED',
        message: 'The wedding is blocked.',
      });
    if (block === 'deletion_scheduled')
      throw new ConflictException({
        statusCode: 409,
        error: 'WEDDING_DELETION_SCHEDULED',
        message: 'The wedding deletion is scheduled.',
      });
    return true;
  }
}
