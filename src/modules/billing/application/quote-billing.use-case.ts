import { Inject, Injectable } from '@nestjs/common';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import type { PaymentKindForPrice, PaymentMethodForPrice } from '../domain/pricing';
import { type BillingQuote, buildQuote, referralDiscountFor } from '../domain/quote';
import { QUOTE_TARGET_READER, type QuoteTargetReader } from './ports/quote-target.reader.port';

/**
 * GET …/billing/quote (Preço e cotação RN04): só o dono (`manage_billing`; a
 * colaboradora recebe 403 e vê as datas pelo GET …/billing). Lê com a RLS do
 * casamento e devolve as linhas da RN01, os totais por forma e os limites da
 * data. O pagamento recalcula a mesma cotação (RN05).
 */
@Injectable()
export class QuoteBilling {
  constructor(
    private readonly authorization: WeddingAuthorization,
    @Inject(QUOTE_TARGET_READER) private readonly reader: QuoteTargetReader,
  ) {}

  async execute({
    userId,
    weddingId,
    kind,
    endDate,
    method,
    installments,
    now,
  }: {
    userId: string;
    weddingId: string;
    kind: PaymentKindForPrice;
    endDate: string | null;
    method: PaymentMethodForPrice;
    installments: number;
    now: Date;
  }): Promise<BillingQuote> {
    await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
    const wedding = await this.reader.read({ weddingId });
    if (!wedding) throw new WeddingNotFoundError();
    const referral =
      kind === 'publication'
        ? referralDiscountFor({
            referrer: wedding.referrer,
            percent: await this.reader.referralDiscountPercent(),
          })
        : null;
    return buildQuote({ wedding, kind, endDate, method, installments, referral, now });
  }
}
