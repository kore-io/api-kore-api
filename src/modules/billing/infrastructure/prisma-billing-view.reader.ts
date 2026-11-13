import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  BillingLifecycle,
  BillingMoneyView,
  BillingViewReader,
} from '../application/ports/billing-view.reader.port';

const day = (value: Date | null): string | null => value?.toISOString().slice(0, 10) ?? null;

/** Na transação da requisição, com a RLS: os pagamentos só aparecem para o dono. */
@Injectable()
export class PrismaBillingViewReader implements BillingViewReader {
  constructor(private readonly tenant: TenantTransaction) {}

  async lifecycle({ weddingId }: { weddingId: string }): Promise<BillingLifecycle | null> {
    const wedding = await this.tenant.client().wedding.findUnique({
      where: { id: weddingId },
      select: {
        status: true,
        publishedAt: true,
        endDate: true,
        paidThrough: true,
        graceUntil: true,
        expiredAt: true,
        purgeAt: true,
        publicationSource: true,
      },
    });
    if (!wedding) return null;
    const [row] = await this.tenant.client().$queryRaw<{ awaiting: boolean | null }[]>`
      SELECT wedding_awaiting_payment(${weddingId}::uuid) AS awaiting`;
    return {
      status: wedding.status,
      publishedAt: wedding.publishedAt,
      endDate: day(wedding.endDate),
      paidThrough: day(wedding.paidThrough),
      graceUntil: day(wedding.graceUntil),
      expiredAt: day(wedding.expiredAt),
      purgeAt: day(wedding.purgeAt),
      publicationSource: wedding.publicationSource,
      awaitingPayment: row?.awaiting ?? false,
    };
  }

  async money({ weddingId, now }: { weddingId: string; now: Date }): Promise<BillingMoneyView> {
    const db = this.tenant.client();
    // O fim do prazo de desistir, no fuso do casamento (o mesmo cálculo da
    // request_payment_refund): só nos pagos e dentro dele.
    const windows = await db.$queryRaw<{ id: string; until: Date }[]>`
      SELECT p.id, (((p.paid_at AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))::date
                     + 8)::timestamp AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))
                   - interval '1 millisecond' AS until
      FROM payments p JOIN weddings w ON w.id = p.wedding_id
      WHERE p.wedding_id = ${weddingId}::uuid AND p.status = 'paid'
        AND p.applied_at IS NOT NULL AND p.paid_at IS NOT NULL`;
    const refundable = new Map(
      windows.filter((row) => row.until > now).map((row) => [row.id, row.until]),
    );
    const [pending, applied, last] = await Promise.all([
      db.payment.findFirst({
        where: { weddingId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          method: true,
          amountCents: true,
          dueAt: true,
          pixCopyPaste: true,
        },
      }),
      // Os não aplicados (appliedAt nulo) não vêm (Pagamentos e arrependimento).
      db.payment.findMany({
        where: { weddingId, appliedAt: { not: null } },
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          kind: true,
          periodStart: true,
          periodEnd: true,
          monthsCovered: true,
          amountCents: true,
          method: true,
          installments: true,
          status: true,
          paidAt: true,
        },
      }),
      db.payment.findFirst({
        where: { weddingId },
        orderBy: { createdAt: 'desc' },
        select: { payerName: true, payerTaxIdLast4: true },
      }),
    ]);
    return {
      pendingPayment: pending
        ? {
            paymentId: pending.id,
            kind: pending.kind,
            method: pending.method,
            amountCents: pending.amountCents,
            dueAt: pending.dueAt,
            pixCopyPaste: pending.pixCopyPaste,
          }
        : null,
      payments: applied.map((payment) => ({
        ...payment,
        refundableUntil: refundable.get(payment.id) ?? null,
        periodStart: day(payment.periodStart) ?? '',
        periodEnd: day(payment.periodEnd) ?? '',
      })),
      lastPayer: last ? { name: last.payerName, taxIdLast4: last.payerTaxIdLast4 } : null,
    };
  }
}
