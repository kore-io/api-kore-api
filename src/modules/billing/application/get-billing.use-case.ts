import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import {
  BILLING_VIEW_READER,
  type BillingLifecycle,
  type BillingMoneyView,
  type BillingViewReader,
} from './ports/billing-view.reader.port';

export type BillingView = BillingLifecycle & { money: BillingMoneyView | null };

/**
 * GET …/billing (Publicar e pagar, Contrato de API): o status e as datas para
 * todo vínculo; o pendente (com o copia e cola, para reabrir a tela do Pix),
 * os pagamentos aplicados e o último pagador só para o dono. A colaboradora
 * não recebe valores (decisão 29), só o "Aguardando pagamento" em booleano.
 */
@Injectable()
export class GetBilling {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(BILLING_VIEW_READER) private readonly reader: BillingViewReader,
  ) {}

  async execute({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<BillingView> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const lifecycle = await this.reader.lifecycle({ weddingId });
    if (!lifecycle) throw new WeddingNotFoundError();
    const owner = await this.authorization.can({ userId, weddingId, action: 'manage_billing' });
    return { ...lifecycle, money: owner ? await this.reader.money({ weddingId }) : null };
  }
}
