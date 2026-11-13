import { Inject, Injectable, Logger } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { endDateRange } from '../../site/domain/publication';
import { CURRENT_PRICE_TABLE } from '../domain/pricing';
import { BILLING_MAILER, type BillingMailer } from './ports/billing-mailer.port';
import { PAYMENT_LEDGER, type PaymentLedger } from './ports/payment-ledger.port';
import {
  type DueNotice,
  WEDDING_LIFECYCLE_STORE,
  type WeddingLifecycleStore,
} from './ports/wedding-lifecycle.port';

const logger = new Logger('WeddingLifecycle');
const BATCH = 500;

export interface LifecycleTally {
  grace: number;
  expired: number;
  notices: number;
  errors: number;
}

/**
 * A rotina diária do ciclo de vida (Data de saída do ar RN02 e RN03), no
 * worker, com o relógio injetado:
 * - primeiro as passagens: carência e expirado (pelo store, numa transação);
 * - depois os avisos devidos pela janela (B4-2): cada um numa transação do
 *   backoffice, que grava o BillingNoticeLog (o único impede o repetido) e a
 *   notificação `billing` às pessoas donas; o e-mail de serviço sai depois do
 *   commit e não se desliga nas preferências (decisão 236). O casamento
 *   bloqueado ou com exclusão agendada não recebe aviso, mas o relógio corre.
 */
@Injectable()
export class AdvanceWeddingLifecycle {
  constructor(
    @Inject(WEDDING_LIFECYCLE_STORE) private readonly store: WeddingLifecycleStore,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(BILLING_MAILER) private readonly mailer: BillingMailer,
    private readonly transaction: BackofficeTransaction,
  ) {}

  async execute({ now, weddingId }: { now: Date; weddingId?: string }): Promise<LifecycleTally> {
    const { grace, expired } = await this.store.advance({ now, weddingId });
    const tally: LifecycleTally = {
      grace: grace.length,
      expired: expired.length,
      notices: 0,
      errors: 0,
    };
    for (const due of await this.store.dueNotices({ now, limit: BATCH, weddingId })) {
      try {
        if (await this.send({ due, now })) tally.notices++;
      } catch (error) {
        tally.errors++;
        logger.warn(`Aviso ${due.notice} de ${due.weddingId} falhou: ${(error as Error).name}`);
      }
    }
    return tally;
  }

  private send({ due, now }: { due: DueNotice; now: Date }): Promise<boolean> {
    return this.transaction.run(async () => {
      const recorded = await this.ledger.recordBillingNotice({
        weddingId: due.weddingId,
        notice: due.notice,
        endDate: due.endDate,
        now,
      });
      if (!recorded) return false;
      const recipients = await this.ledger.billingRecipients({ weddingId: due.weddingId });
      const partnerNames = await this.ledger.partnerNames({ weddingId: due.weddingId });
      const renewUntil =
        endDateRange({ eventDate: due.eventDate, timezone: due.timezone ?? 'America/Sao_Paulo' })
          ?.max ?? null;
      // Sem pagamento: a chave do agrupamento é a do aviso e da endDate.
      await this.ledger.notifyBilling({
        weddingId: due.weddingId,
        paymentId: due.weddingId,
        event: 'payment_confirmed',
        groupKey: `billing:${due.notice}:${due.endDate}`,
        userIds: recipients.map((recipient) => recipient.userId),
        payload: payloadOf({ due, renewUntil, now }),
        now,
      });
      for (const recipient of recipients) {
        this.transaction.schedule(() => {
          switch (due.notice) {
            case 'end_date_in_7_days':
              return this.mailer.endDateSoon({
                notice: {
                  to: recipient.email,
                  firstName: recipient.firstName,
                  endDate: due.endDate,
                  monthlyCents: CURRENT_PRICE_TABLE.monthlyCents,
                  partnerNames,
                },
              });
            case 'grace_day_1':
            case 'grace_day_5':
              return this.mailer.graceStarted({
                notice: {
                  to: recipient.email,
                  graceUntil: due.graceUntil ?? due.endDate,
                  partnerNames,
                },
              });
            case 'expired':
              return this.mailer.siteExpired({
                notice: {
                  to: recipient.email,
                  expiredAt: due.expiredAt ?? due.endDate,
                  renewUntil,
                  partnerNames,
                },
              });
          }
        });
      }
      return true;
    });
  }
}

/**
 * O item da central (RN03): o app monta o texto da Pena com as datas ("O site
 * fica no ar até 14 de fev., daqui a 7 dias…", "…só até 21 de fev", "O site
 * saiu do ar…"); sem valor de pagamento.
 */
function payloadOf({
  due,
  renewUntil,
  now,
}: {
  due: DueNotice;
  renewUntil: string | null;
  now: Date;
}): Record<string, unknown> {
  const at = now.toISOString();
  switch (due.notice) {
    case 'end_date_in_7_days':
      return { kind: 'end_date_soon', endDate: due.endDate, daysLeft: due.daysLeft, at };
    case 'grace_day_1':
    case 'grace_day_5':
      return {
        kind: 'grace',
        day: due.notice === 'grace_day_1' ? 1 : 5,
        endDate: due.endDate,
        graceUntil: due.graceUntil,
        at,
      };
    case 'expired':
      return { kind: 'expired', expiredAt: due.expiredAt, renewUntil, at };
  }
}
