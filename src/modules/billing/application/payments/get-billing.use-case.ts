import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '@/modules/access/application/services/wedding-authorization.service';
import { WeddingNotFoundError } from '@/modules/access/domain/access.errors';
import {
  BILLING_VIEW_READER,
  type BillingLifecycle,
  type BillingMoneyView,
  type BillingViewReader,
} from '@/modules/billing/application/ports/billing-view.reader.port';
import {
  GATEWAY_CUSTOMERS,
  type GatewayCustomers,
} from '@/modules/billing/application/ports/payment-request.store.port';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/billing/application/ports/payment-gateway.port';

/**
 * O último pagador, para o "Ana Beatriz Moreira · CPF final 4821" (RN02). O
 * `payerId` é o cliente dele no gateway atual: o app paga de novo sem o CPF
 * (RN03; decisão 316(3)); nulo, o app pede o CPF.
 */
export interface BillingLastPayer {
  name: string;
  taxIdLast4: string;
  payerId: string | null;
}

export type BillingView = BillingLifecycle & {
  money: (Omit<BillingMoneyView, 'lastPayer'> & { lastPayer: BillingLastPayer | null }) | null;
};

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
    @Inject(GATEWAY_CUSTOMERS) private readonly customers: GatewayCustomers,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async execute({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<BillingView> {
    await this.authorization.require({ userId, weddingId, action: 'view' });
    const lifecycle = await this.reader.lifecycle({ weddingId });
    if (!lifecycle) throw new WeddingNotFoundError();
    const owner = await this.authorization.can({ userId, weddingId, action: 'manage_billing' });
    if (!owner) return { ...lifecycle, money: null };
    const { lastPayer, ...money } = await this.reader.money({ weddingId, now });
    return {
      ...lifecycle,
      money: {
        ...money,
        lastPayer: lastPayer
          ? {
              name: lastPayer.name,
              taxIdLast4: lastPayer.taxIdLast4,
              payerId: await this.customers.idOf({
                weddingId,
                gateway: this.gateway.name,
                payerTaxIdHash: lastPayer.taxIdHash,
              }),
            }
          : null,
      },
    };
  }
}
