import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import { PaymentPendingError } from '../domain/billing.errors';
import type {
  NewPendingPayment,
  OwnedPayment,
  PaymentRequestStore,
} from '../application/ports/payment-request.store.port';
import type { QuoteTarget } from '../application/ports/quote-target.reader.port';

const OWNED_SELECT = {
  id: true,
  kind: true,
  status: true,
  method: true,
  installments: true,
  amountCents: true,
  requestHash: true,
  gatewayPaymentId: true,
  pixCopyPaste: true,
  dueAt: true,
  failureReason: true,
} as const;

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/** Na transação da requisição, com a RLS do dono (Publicar e pagar RN20). */
@Injectable()
export class PrismaPaymentRequestStore implements PaymentRequestStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async lockWedding({ weddingId }: { weddingId: string }): Promise<QuoteTarget | null> {
    const [row] = await this.tenant.client().$queryRaw<
      (Omit<QuoteTarget, 'referrer'> & {
        referrerKind: 'planner' | 'seller' | null;
        referrerStatus: 'active' | 'blocked' | 'inactive' | null;
        referralDiscountEnabled: boolean | null;
      })[]
    >`
      SELECT w.status::text AS status, w.slug::text AS slug,
             to_char(w.event_date, 'YYYY-MM-DD') AS "eventDate", w.timezone,
             to_char(w.end_date, 'YYYY-MM-DD') AS "endDate",
             to_char(w.paid_through, 'YYYY-MM-DD') AS "paidThrough",
             w.published_at AS "publishedAt", w.blocked_at AS "blockedAt",
             w.deletion_scheduled_for AS "deletionScheduledFor",
             r.kind::text AS "referrerKind", r.status::text AS "referrerStatus",
             r.referral_discount_enabled AS "referralDiscountEnabled"
      FROM weddings w
      LEFT JOIN referrers r ON r.id = w.referrer_id
      WHERE w.id = ${weddingId}::uuid
      FOR UPDATE OF w`;
    if (!row) return null;
    const { referrerKind, referrerStatus, referralDiscountEnabled, ...wedding } = row;
    return {
      ...wedding,
      referrer:
        referrerKind && referrerStatus
          ? {
              kind: referrerKind,
              status: referrerStatus,
              referralDiscountEnabled: referralDiscountEnabled ?? false,
            }
          : null,
    };
  }

  byIdempotencyKey({
    weddingId,
    idempotencyKey,
  }: {
    weddingId: string;
    idempotencyKey: string;
  }): Promise<OwnedPayment | null> {
    return this.tenant.client().payment.findUnique({
      where: { weddingId_idempotencyKey: { weddingId, idempotencyKey } },
      select: OWNED_SELECT,
    });
  }

  async hasPending({
    weddingId,
    kind,
  }: {
    weddingId: string;
    kind: 'publication' | 'extension';
  }): Promise<boolean> {
    const pending = await this.tenant.client().payment.findFirst({
      where: { weddingId, kind, status: 'pending' },
      select: { id: true },
    });
    return pending !== null;
  }

  async hasRefundInProgress({ weddingId }: { weddingId: string }): Promise<boolean> {
    const refunding = await this.tenant.client().payment.findFirst({
      where: { weddingId, kind: 'publication', status: 'refund_requested' },
      select: { id: true },
    });
    return refunding !== null;
  }

  async insertPending({ payment }: { payment: NewPendingPayment }): Promise<void> {
    try {
      // createMany não usa RETURNING; a leitura vem depois, pela RLS do dono.
      await this.tenant.client().payment.createMany({
        data: [
          {
            ...payment,
            status: 'pending',
            externalReference: payment.id,
            periodStart: day(payment.periodStart),
            periodEnd: day(payment.periodEnd),
            previousEndDate: payment.previousEndDate ? day(payment.previousEndDate) : null,
            previousPaidThrough: payment.previousPaidThrough
              ? day(payment.previousPaidThrough)
              : null,
          },
        ],
      });
    } catch (error) {
      // O único do pendente (RN07): outro pedido ganhou a corrida.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new PaymentPendingError();
      throw error;
    }
  }

  byId({ weddingId, paymentId }: { weddingId: string; paymentId: string }) {
    return this.tenant.client().payment.findFirst({
      where: { id: paymentId, weddingId },
      select: OWNED_SELECT,
    });
  }

  async recordCharge(input: {
    paymentId: string;
    gatewayPaymentId: string;
    refused: boolean;
    pixCopyPaste: string | null;
    dueAt: Date | null;
    cardLast4: string | null;
    failureReason: string | null;
  }): Promise<boolean> {
    const [row] = await this.tenant.client().$queryRaw<{ recorded: boolean }[]>`
      SELECT record_payment_charge(${input.paymentId}::uuid, ${input.gatewayPaymentId},
        ${input.refused}, ${input.pixCopyPaste}, ${input.dueAt}::timestamptz, ${input.cardLast4},
        ${input.failureReason}) AS recorded`;
    return row?.recorded ?? false;
  }

  async setEndDate({
    weddingId,
    endDate,
    today,
    now,
  }: {
    weddingId: string;
    endDate: string;
    today: string;
    now: Date;
  }): Promise<string | null> {
    const [row] = await this.tenant.client().$queryRaw<{ status: string | null }[]>`
      SELECT set_wedding_end_date(${weddingId}::uuid, ${endDate}::date, ${today}::date,
                                  ${now}::timestamptz) AS status`;
    return row?.status ?? null;
  }

  async pendingExtensionId({ weddingId }: { weddingId: string }): Promise<string | null> {
    const pending = await this.tenant.client().payment.findFirst({
      where: { weddingId, kind: 'extension', status: 'pending' },
      select: { id: true },
    });
    return pending?.id ?? null;
  }
}
