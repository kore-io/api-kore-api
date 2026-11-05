import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { WeddingAuthorization } from '../application/wedding-authorization.service';
import { WeddingNotFoundError } from '../domain/access.errors';
import type { MembershipRole } from '../domain/wedding-authorization';
import { toHttpError } from './access-http-errors';
import type { AuthenticatedRequest } from './authenticated-request';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WeddingScopedRequest extends AuthenticatedRequest {
  /** O papel da pessoa no casamento da rota, já conferido (RN01 de Papéis). */
  weddingRole?: MembershipRole;
}

/**
 * Toda requisição autenticada roda numa transação com SET LOCAL app.user_id
 * (decisão 153). Nas rotas de um casamento (:weddingId), também app.wedding_id,
 * e a pessoa precisa de vínculo ativo: sem ele, 404 (RN01 de Papéis), para não
 * revelar que o casamento existe.
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly tenant: TenantTransaction,
    private readonly authorization: WeddingAuthorization,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const request = context.switchToHttp().getRequest<WeddingScopedRequest>();
    const auth = request.auth;
    if (!auth) return next.handle();

    const params = request.params as Record<string, string | undefined>;
    const weddingId = params.weddingId;
    if (weddingId !== undefined && !UUID.test(weddingId))
      throw toHttpError(new WeddingNotFoundError());

    return from(
      this.tenant
        .run({
          userId: auth.userId,
          weddingId,
          work: async (): Promise<unknown> => {
            if (weddingId) {
              request.weddingRole = await this.authorization.require({
                userId: auth.userId,
                weddingId,
                action: 'view',
              });
            }
            return lastValueFrom(next.handle(), { defaultValue: undefined });
          },
        })
        .catch((error: unknown) => {
          throw toHttpError(error);
        }),
    );
  }
}
