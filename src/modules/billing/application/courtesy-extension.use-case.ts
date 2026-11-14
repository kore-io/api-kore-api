import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { localDate } from '../../../shared/time/local-date';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import { endDateRange } from '../../site/domain/publication';
import { BillingEndDateOutOfRangeError, NotPublishedError } from '../domain/billing.errors';
import { addMonths } from '../domain/pricing';
import { ADMIN_BILLING_STORE, type AdminBillingStore } from './ports/admin-billing.store.port';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';

const EXTENDABLE = ['published', 'post_event', 'grace', 'expired'];
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

/**
 * Estender como cortesia (Backoffice - cobrança RN06; decisões 38, 39, 73 e
 * 80): meses e motivo, num casamento publicado, em pós-evento, carência ou
 * expirado (também bloqueado, decisão 86). A nova data conta da endDate, ou de
 * hoje se expirado, até 12 meses depois do casamento. Grava a CourtesyExtension
 * e, na mesma transação, a endDate e o paidThrough (invariante 6), com as
 * transições da Data de saída do ar RN04; sem Payment e sem comissão. O casal
 * recebe a notificação `billing` (`kind: courtesy`); o Pix de extensão pendente
 * é cancelado depois do commit (B10-5).
 */
@Injectable()
export class ExtendAsCourtesy {
  constructor(
    private readonly transaction: BackofficeTransaction,
    @Inject(ADMIN_BILLING_STORE) private readonly store: AdminBillingStore,
    @Inject(REFUND_QUEUE) private readonly queue: RefundQueue,
  ) {}

  execute({
    weddingId,
    adminUserId,
    months,
    reason,
    now,
  }: {
    weddingId: string;
    adminUserId: string;
    months: number;
    reason: string;
    now: Date;
  }): Promise<{ previousEndDate: string; newEndDate: string; canceledPaymentId: string | null }> {
    return this.transaction.run(async () => {
      const wedding = await this.store.lockWeddingForCourtesy({ weddingId });
      if (!wedding) throw new WeddingNotFoundError();
      const previousEndDate = day(wedding.endDate);
      if (!EXTENDABLE.includes(wedding.status) || !previousEndDate) throw new NotPublishedError();
      const today = localDate({ at: now, timezone: wedding.timezone });
      const from = wedding.status === 'expired' ? today : previousEndDate;
      const newEndDate = addMonths({ day: from, months });
      const range = endDateRange({ eventDate: day(wedding.eventDate), timezone: wedding.timezone });
      if (!range || newEndDate > range.max)
        throw new BillingEndDateOutOfRangeError(range?.min ?? null, range?.max ?? null);
      const { pendingExtensionIds } = await this.store.recordCourtesy({
        weddingId,
        adminUserId,
        months,
        reason,
        previous: wedding,
        previousEndDate,
        periodStart: from,
        newEndDate,
        now,
      });
      for (const id of pendingExtensionIds)
        this.transaction.schedule(() =>
          this.queue.enqueueCancel({ paymentId: id, reason: 'courtesy_extended' }),
        );
      return {
        previousEndDate,
        newEndDate,
        // O Pix de extensão pendente cancelado depois do commit (B10-5).
        canceledPaymentId: pendingExtensionIds[0] ?? null,
      };
    });
  }
}
