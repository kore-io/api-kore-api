import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type {
  AdminPaymentDetail,
  AdminPaymentQuery,
  AdminPaymentRow,
  AdminPaymentsReader,
} from '../../application/ports/admin-payments.reader.port';
import type { Page } from '../../application/ports/admin-weddings.reader.port';
import type { PaymentsCsvRow } from '../../domain/payments-csv';

const PAGE_SIZE = 50;
const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';
/** "P-0431": o código curto, sequencial (RN03). */
export const paymentCode = (shortCode: number) => `P-${String(shortCode).padStart(4, '0')}`;

const ROW_SELECT = {
  id: true,
  shortCode: true,
  weddingId: true,
  kind: true,
  amountCents: true,
  method: true,
  status: true,
  appliedAt: true,
  refundOrigin: true,
  createdAt: true,
  paidAt: true,
  wedding: {
    select: { partners: { orderBy: { slot: 'asc' }, select: { displayName: true } } },
  },
} satisfies Prisma.PaymentSelect;

type RowSource = Prisma.PaymentGetPayload<{ select: typeof ROW_SELECT }>;

function toRow(payment: RowSource): AdminPaymentRow {
  const partners = payment.wedding.partners;
  return {
    id: payment.id,
    code: paymentCode(payment.shortCode),
    weddingId: payment.weddingId,
    coupleNames: partners.length ? partners.map((p) => firstName(p.displayName)).join(' & ') : null,
    kind: payment.kind,
    amountCents: payment.amountCents,
    method: payment.method,
    status: payment.status,
    applied: payment.appliedAt !== null,
    refundOrigin: payment.refundOrigin,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
  };
}

const referrerName = (referrer: {
  user: { name: string | null };
  planner: { creditName: string } | null;
}) => referrer.planner?.creditName ?? referrer.user.name ?? '';

/** Pela conexão do backoffice (decisão 180(5)). */
@Injectable()
export class PrismaAdminPaymentsReader implements AdminPaymentsReader {
  constructor(private readonly db: BackofficePrismaService) {}

  async list(query: AdminPaymentQuery): Promise<Page<AdminPaymentRow>> {
    const where: Prisma.PaymentWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [total, payments] = await Promise.all([
      this.db.payment.count({ where }),
      this.db.payment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: ROW_SELECT,
      }),
    ]);
    return { items: payments.map(toRow), page: query.page, pageSize: PAGE_SIZE, total };
  }

  async detail({ paymentId }: { paymentId: string }): Promise<AdminPaymentDetail | null> {
    const payment = await this.db.payment.findUnique({
      where: { id: paymentId },
      select: {
        ...ROW_SELECT,
        installments: true,
        monthsCovered: true,
        periodStart: true,
        periodEnd: true,
        activationListCents: true,
        monthlyListCents: true,
        capDiscountCents: true,
        referralDiscountCents: true,
        pixDiscountCents: true,
        installmentInterestCents: true,
        gatewayFeeCents: true,
        netCents: true,
        payerTaxIdLast4: true,
        gatewayPaymentId: true,
        appliedByAdminAt: true,
        refundRequestedAt: true,
        refundReason: true,
        refundAttempts: true,
        refundLastError: true,
        refundFailedAt: true,
        refundedAt: true,
        refundedOutsideGateway: true,
        disputedAt: true,
        disputeDeadline: true,
        commission: {
          select: {
            amountCents: true,
            ratePercent: true,
            status: true,
            referrer: {
              select: {
                id: true,
                user: { select: { name: true } },
                planner: { select: { creditName: true } },
              },
            },
          },
        },
        wedding: {
          select: {
            partners: { orderBy: { slot: 'asc' }, select: { displayName: true } },
            referrer: {
              select: {
                id: true,
                user: { select: { name: true } },
                planner: { select: { creditName: true } },
              },
            },
          },
        },
      },
    });
    if (!payment) return null;
    // O motivo do Admin fica no log (o refundReason é o texto do casal).
    const adminReason =
      payment.refundOrigin === 'admin' || payment.refundOrigin === 'manual'
        ? ((
            (
              await this.db.applicationLog.findFirst({
                where: {
                  entityType: 'payment',
                  entityId: paymentId,
                  action: { in: ['payment.refund_requested', 'payment.refund_recorded_manually'] },
                },
                orderBy: { createdAt: 'desc' },
                select: { data: true },
              })
            )?.data as { reason?: string } | null
          )?.reason ?? null)
        : null;
    const referrer = payment.commission?.referrer ?? payment.wedding.referrer;
    return {
      ...toRow(payment),
      installments: payment.installments,
      monthsCovered: payment.monthsCovered,
      periodStart: day(payment.periodStart) ?? '',
      periodEnd: day(payment.periodEnd) ?? '',
      activationListCents: payment.activationListCents,
      monthlyListCents: payment.monthlyListCents,
      capDiscountCents: payment.capDiscountCents,
      referralDiscountCents: payment.referralDiscountCents,
      pixDiscountCents: payment.pixDiscountCents,
      installmentInterestCents: payment.installmentInterestCents,
      gatewayFeeCents: payment.gatewayFeeCents,
      netCents: payment.netCents,
      payerTaxIdLast4: payment.payerTaxIdLast4,
      gatewayPaymentId: payment.gatewayPaymentId,
      appliedAt: payment.appliedAt,
      appliedByAdminAt: payment.appliedByAdminAt,
      referrer: referrer ? { id: referrer.id, name: referrerName(referrer) } : null,
      commission: payment.commission
        ? {
            amountCents: payment.commission.amountCents,
            ratePercent: payment.commission.ratePercent,
            status: payment.commission.status,
          }
        : null,
      refund: {
        origin: payment.refundOrigin,
        requestedAt: payment.refundRequestedAt,
        reason: payment.refundOrigin === 'couple' ? payment.refundReason : adminReason,
        attempts: payment.refundAttempts,
        lastError: payment.refundLastError,
        failedAt: payment.refundFailedAt,
        refundedAt: payment.refundedAt,
        outsideGateway: payment.refundedOutsideGateway,
      },
      dispute: { disputedAt: payment.disputedAt, deadline: day(payment.disputeDeadline) },
    };
  }

  async exportRows({ from, to }: { from: Date; to: Date }): Promise<PaymentsCsvRow[]> {
    const payments = await this.db.payment.findMany({
      where: {
        OR: [{ paidAt: { gte: from, lte: to } }, { refundedAt: { gte: from, lte: to } }],
      },
      orderBy: [{ paidAt: 'asc' }, { shortCode: 'asc' }],
      select: {
        ...ROW_SELECT,
        installments: true,
        installmentInterestCents: true,
        gatewayFeeCents: true,
        netCents: true,
        refundedAt: true,
        gatewayPaymentId: true,
      },
    });
    const rows: PaymentsCsvRow[] = [];
    for (const payment of payments) {
      const row = toRow(payment);
      const base = {
        code: row.code,
        coupleNames: row.coupleNames ?? 'Casamento apagado',
        kind: row.kind,
        method: row.method,
        installments: payment.installments,
        status: row.status,
        applied: row.applied,
        gatewayPaymentId: payment.gatewayPaymentId,
      };
      const without = payment.amountCents - payment.installmentInterestCents;
      if (payment.paidAt && payment.paidAt >= from && payment.paidAt <= to)
        rows.push({
          ...base,
          line: 'pagamento',
          amountWithoutInterestCents: without,
          interestCents: payment.installmentInterestCents,
          gatewayFeeCents: payment.gatewayFeeCents,
          netCents: payment.netCents,
          paidAt: payment.paidAt,
          refundedAt: null,
        });
      if (payment.refundedAt && payment.refundedAt >= from && payment.refundedAt <= to)
        rows.push({
          ...base,
          line: 'estorno',
          amountWithoutInterestCents: -without,
          interestCents: -payment.installmentInterestCents,
          // A taxa do gateway não volta (RN05).
          gatewayFeeCents: null,
          netCents: -payment.amountCents,
          paidAt: payment.paidAt,
          refundedAt: payment.refundedAt,
        });
    }
    return rows;
  }

  async ofWedding({ weddingId }: { weddingId: string }) {
    if ((await this.db.wedding.count({ where: { id: weddingId } })) === 0) return null;
    const [payments, courtesies] = await Promise.all([
      this.db.payment.findMany({
        where: { weddingId, status: { notIn: ['canceled'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          ...ROW_SELECT,
          commission: {
            select: {
              amountCents: true,
              status: true,
              referrer: {
                select: {
                  user: { select: { name: true } },
                  planner: { select: { creditName: true } },
                },
              },
            },
          },
        },
      }),
      this.db.courtesyExtension.findMany({
        where: { weddingId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          months: true,
          createdAt: true,
          newEndDate: true,
          adminUser: { select: { name: true } },
        },
      }),
    ]);
    return {
      payments: payments.map((payment) => ({
        ...toRow(payment),
        commission: payment.commission
          ? {
              amountCents: payment.commission.amountCents,
              status: payment.commission.status,
              referrerName: referrerName(payment.commission.referrer),
            }
          : null,
      })),
      courtesies: courtesies.map((courtesy) => ({
        id: courtesy.id,
        months: courtesy.months,
        createdAt: courtesy.createdAt,
        adminName: courtesy.adminUser?.name ?? null,
        newEndDate: day(courtesy.newEndDate) ?? '',
      })),
    };
  }
}
