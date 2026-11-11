import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { WeddingScope } from '../application/wedding-scope.service';
import { WeddingNotFoundError } from '../domain/access.errors';
import type { MembershipRole } from '../domain/wedding-authorization';
import { toHttpError } from './access-http-errors';
import type { AuthenticatedRequest } from './authenticated-request';
import { OWN_TRANSACTIONS } from './own-transactions.decorator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WeddingScopedRequest extends AuthenticatedRequest {
  /** O papel da pessoa no casamento da rota, já conferido (RN01 de Papéis). */
  weddingRole?: MembershipRole;
}

/**
 * Toda requisição autenticada roda numa transação com SET LOCAL app.user_id
 * (decisão 153). Nas rotas de um casamento (:weddingId), também app.wedding_id,
 * e a pessoa precisa de vínculo ativo: sem ele, 404 (RN01 de Papéis), para não
 * revelar que o casamento existe. O acesso de um membro conta como atividade
 * do casamento (RN13 de Convites).
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly scope: WeddingScope,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<WeddingScopedRequest>();
    const auth = request.auth;
    if (!auth) return next.handle();

    const params = request.params as Record<string, string | undefined>;
    const weddingId = params.weddingId;
    if (weddingId !== undefined && !UUID.test(weddingId))
      throw toHttpError(new WeddingNotFoundError());
    // A rota abre as próprias transações, curtas, pelo WeddingScope.
    if (this.reflector.get<boolean>(OWN_TRANSACTIONS, context.getHandler())) return next.handle();

    return from(
      this.scope
        .run({
          userId: auth.userId,
          weddingId,
          work: async ({ role }): Promise<unknown> => {
            if (role) request.weddingRole = role;
            return lastValueFrom(next.handle(), { defaultValue: undefined });
          },
        })
        .catch((error: unknown) => {
          throw toHttpError(error);
        }),
    );
  }
}
