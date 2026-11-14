import { Inject, Injectable } from '@nestjs/common';
import { BackofficeTransaction } from '../../../shared/database/backoffice-transaction';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { localDate } from '../../../shared/time/local-date';
import { endDateRange } from '../../site/domain/publication';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import { BillingEndDateOutOfRangeError, NotPublishedError } from '../domain/billing.errors';
import { addMonths } from '../domain/pricing';
import { REFUND_QUEUE, type RefundQueue } from './ports/refund-queue.port';
import type { Prisma } from '../../../generated/prisma/client';

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
  }): Promise<{ endDate: string }> {
    return this.transaction.run(async (tx) => {
      const [wedding] = await tx.$queryRaw<
        {
          status: string;
          endDate: Date | null;
          paidThrough: Date | null;
          eventDate: Date | null;
          timezone: string | null;
        }[]
      >`
        SELECT status::text AS status, end_date AS "endDate", paid_through AS "paidThrough",
               event_date AS "eventDate", timezone
        FROM weddings WHERE id = ${weddingId}::uuid AND status <> 'purged' FOR UPDATE`;
      if (!wedding) throw new WeddingNotFoundError();
      if (!EXTENDABLE.includes(wedding.status) || !wedding.endDate) throw new NotPublishedError();
      const today = localDate({ at: now, timezone: wedding.timezone });
      const from = wedding.status === 'expired' ? today : (day(wedding.endDate) as string);
      const newEndDate = addMonths({ day: from, months });
      const range = endDateRange({ eventDate: day(wedding.eventDate), timezone: wedding.timezone });
      if (!range || newEndDate > range.max)
        throw new BillingEndDateOutOfRangeError(range?.min ?? null, range?.max ?? null);
      const end = new Date(`${newEndDate}T00:00:00Z`);
      await tx.courtesyExtension.create({
        data: {
          id: uuidV7({ now: now.getTime() }),
          weddingId,
          adminUserId,
          months,
          reason,
          previousEndDate: wedding.endDate,
          previousPaidThrough: wedding.paidThrough,
          newEndDate: end,
          periodStart: new Date(`${from}T00:00:00Z`),
          periodEnd: end,
        },
      });
      // As mesmas transições da extensão paga (Data de saída do ar RN04).
      await tx.$executeRaw`
        UPDATE weddings
        SET end_date = ${end}, paid_through = ${end},
            status = CASE
              WHEN status = 'grace' AND event_date >= (${now}::timestamptz AT TIME ZONE
                     coalesce(timezone, 'America/Sao_Paulo'))::date THEN 'published'::wedding_status
              WHEN status IN ('grace', 'expired') THEN 'post_event'::wedding_status
              ELSE status END,
            grace_until = NULL, expired_at = NULL, purge_at = NULL, purge_notice_sent_at = NULL,
            updated_at = ${now}
        WHERE id = ${weddingId}::uuid`;
      await tx.applicationLog.create({
        data: {
          createdAt: now,
          action: 'wedding.courtesy_extended',
          actorKind: 'admin',
          actorUserId: adminUserId,
          weddingId,
          entityType: 'wedding',
          entityId: weddingId,
          data: { months, reason, previousEndDate: day(wedding.endDate), newEndDate },
        },
      });
      // "O Kore estendeu o site sem custo. Ele fica no ar até 14 de mai. de 2027."
      const owners = await tx.membership.findMany({
        where: { weddingId, role: 'owner', removedAt: null },
        select: { userId: true },
      });
      if (owners.length > 0)
        await tx.notification.createMany({
          data: owners.map(({ userId }) => ({
            id: uuidV7({ now: now.getTime() }),
            userId,
            weddingId,
            type: 'billing' as const,
            groupKey: `billing:courtesy:${newEndDate}`,
            payload: [
              { kind: 'courtesy', endDate: newEndDate, at: now.toISOString() },
            ] as Prisma.InputJsonValue,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        });
      const pending = await tx.payment.findMany({
        where: { weddingId, kind: 'extension', status: 'pending' },
        select: { id: true },
      });
      for (const { id } of pending)
        this.transaction.schedule(() =>
          this.queue.enqueueCancel({ paymentId: id, reason: 'courtesy_extended' }),
        );
      return { endDate: newEndDate };
    });
  }
}
