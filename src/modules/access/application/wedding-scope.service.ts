import { Inject, Injectable } from '@nestjs/common';
import { SupportContext } from '../../../shared/database/support-context';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { MembershipRole } from '../domain/wedding-authorization';
import { WEDDING_ACTIVITY, type WeddingActivity } from './ports/wedding-activity.port';
import { WeddingAuthorization } from './wedding-authorization.service';

/**
 * Uma transação com a RLS ligada (decisão 153): SET LOCAL app.user_id e, num
 * casamento, app.wedding_id, o vínculo ativo exigido (sem ele, 404; RN01 de
 * Papéis) e o acesso contado como atividade (RN13 de Convites). É o que o
 * TenantTransactionInterceptor faz em toda requisição; a rota com
 * @OwnTransactions() chama este serviço para abrir transações curtas.
 */
@Injectable()
export class WeddingScope {
  constructor(
    private readonly tenant: TenantTransaction,
    private readonly authorization: WeddingAuthorization,
    @Inject(WEDDING_ACTIVITY) private readonly activity: WeddingActivity,
    private readonly support: SupportContext,
  ) {}

  run<T>({
    userId,
    weddingId,
    work,
  }: {
    userId: string;
    weddingId?: string;
    work: ({ role }: { role: MembershipRole | null }) => Promise<T>;
  }): Promise<T> {
    return this.tenant.run({
      userId,
      weddingId,
      work: async () => {
        if (!weddingId) return work({ role: null });
        const role = await this.authorization.require({ userId, weddingId, action: 'view' });
        // Abrir o casamento conta como atividade da RN13 (decisões 136 e 180);
        // o Ver como o casal só lê (Backoffice - acesso RN08).
        if (!this.support.forWedding(weddingId))
          await this.activity.touch({ weddingId, now: new Date() });
        return work({ role });
      },
    });
  }
}
