import { Injectable } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import type { StaffRole } from '@/modules/backoffice/domain/staff';
import type {
  AdminReferrerBalances,
  AdminReferrerListQuery,
  AdminReferrerPayout,
  AdminReferrerProfile,
  AdminReferrerRow,
  AdminReferrersReader,
  AdminReferrerStatementEntry,
  AdminReferrerStatus,
} from '@/modules/backoffice/application/ports/admin-referrers.reader.port';
import type {
  AdminWeddingRow,
  Page,
} from '@/modules/backoffice/application/ports/admin-weddings.reader.port';
import { ADMIN_PAGE_SIZE, ROW_SELECT, toRow } from './prisma-admin-weddings.reader';

const STATEMENT_PAGE_SIZE = 50;

/** O repasse ainda não pago: o dinheiro "em repasse" e a tag "Repasse pedido". */
const OPEN_PAYOUT = Prisma.sql`('requested', 'held', 'processing')`;

interface RowSource {
  id: string;
  kind: 'planner';
  name: string | null;
  credit_name: string | null;
  email: string;
  cities: string[] | null;
  status: AdminReferrerStatus;
  couples_count: bigint;
  available_cents: bigint;
  pending_cents: bigint;
  received_cents: bigint;
  in_payout_cents: bigint;
  payout_requested: boolean;
}

/**
 * As colunas da linha (RN08). As somas saem do Postgres como `bigint` (G8) e
 * seguem a regra dos saldos da indicadora (Comissões do indicador RN02 e
 * RN07): `blocked`, `held` e `reversed` ficam fora; o Disponível soma os
 * ajustes sem repasse; o "em repasse" e o Já recebido contam as comissões e os
 * ajustes pelo estado do repasse em que estão.
 */
const ROW_COLUMNS = Prisma.sql`
  r.id, r.kind, u.name, pl.credit_name, u.email::text AS email, pl.cities, r.status,
  (SELECT count(*) FROM weddings w WHERE w.referrer_id = r.id AND w.status <> 'purged') AS couples_count,
  (SELECT coalesce(sum(c.amount_cents), 0) FROM commissions c
     WHERE c.referrer_id = r.id AND c.status = 'available' AND c.payout_id IS NULL)
  + (SELECT coalesce(sum(a.amount_cents), 0) FROM commission_adjustments a
     WHERE a.referrer_id = r.id AND a.payout_id IS NULL) AS available_cents,
  (SELECT coalesce(sum(c.amount_cents), 0) FROM commissions c
     WHERE c.referrer_id = r.id AND c.status = 'pending') AS pending_cents,
  (SELECT coalesce(sum(c.amount_cents), 0) FROM commissions c
     WHERE c.referrer_id = r.id AND c.status = 'paid')
  + (SELECT coalesce(sum(a.amount_cents), 0) FROM commission_adjustments a
     JOIN payouts p ON p.id = a.payout_id
     WHERE a.referrer_id = r.id AND p.status = 'paid') AS received_cents,
  (SELECT coalesce(sum(c.amount_cents), 0) FROM commissions c
     JOIN payouts p ON p.id = c.payout_id
     WHERE c.referrer_id = r.id AND c.status = 'available' AND p.status IN ${OPEN_PAYOUT})
  + (SELECT coalesce(sum(a.amount_cents), 0) FROM commission_adjustments a
     JOIN payouts p ON p.id = a.payout_id
     WHERE a.referrer_id = r.id AND p.status IN ${OPEN_PAYOUT}) AS in_payout_cents,
  EXISTS (SELECT 1 FROM payouts p
     WHERE p.referrer_id = r.id AND p.status IN ('requested', 'held')) AS payout_requested`;

const FROM = Prisma.sql`
  FROM referrers r
  JOIN users u ON u.id = r.user_id
  LEFT JOIN planners pl ON pl.referrer_id = r.id`;

function toRowOf({ row, role }: { row: RowSource; role: StaffRole }): AdminReferrerRow {
  const balances: AdminReferrerBalances = {
    availableCents: Number(row.available_cents),
    pendingCents: Number(row.pending_cents),
    receivedCents: Number(row.received_cents),
    inPayoutCents: Number(row.in_payout_cents),
  };
  return {
    id: row.id,
    kind: row.kind,
    name: row.name ?? '',
    creditName: row.credit_name,
    email: row.email,
    cities: row.cities ?? [],
    status: row.status,
    couplesCount: Number(row.couples_count),
    balances,
    // "Repasses pedidos" é do Admin (decisão 69).
    ...(role === 'admin' ? { payoutRequested: row.payout_requested } : {}),
  };
}

const partnerNames = (first: string | null, second: string | null) =>
  [first, second]
    .map((name) => (name ?? '').trim().split(/\s+/)[0] ?? '')
    .filter((name) => name.length > 0)
    .join(' & ');

/** Pela conexão do backoffice (decisão 180(5)): fora da RLS por casamento. */
@Injectable()
export class PrismaAdminReferrersReader implements AdminReferrersReader {
  constructor(private readonly db: BackofficePrismaService) {}

  async list(query: AdminReferrerListQuery & { role: StaffRole }): Promise<Page<AdminReferrerRow>> {
    const and: Prisma.Sql[] = [Prisma.sql`r.kind = ${query.kind}::referrer_kind`];
    if (query.status) and.push(Prisma.sql`r.status = ${query.status}::referrer_status`);
    // A cidade como foi escrita no perfil, sem diferenciar maiúsculas.
    if (query.city)
      and.push(
        Prisma.sql`EXISTS (SELECT 1 FROM unnest(pl.cities) city WHERE lower(city) = lower(${query.city}))`,
      );
    if (query.hasPayout !== undefined)
      and.push(
        Prisma.sql`${query.hasPayout ? Prisma.empty : Prisma.sql`NOT`} EXISTS (SELECT 1 FROM payouts p
          WHERE p.referrer_id = r.id AND p.status IN ('requested', 'held'))`,
      );
    const where = Prisma.sql`WHERE ${Prisma.join(and, ' AND ')}`;
    const [counted, rows] = await Promise.all([
      this.db.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${FROM} ${where}`,
      this.db.$queryRaw<RowSource[]>`
        SELECT ${ROW_COLUMNS} ${FROM} ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${ADMIN_PAGE_SIZE} OFFSET ${(query.page - 1) * ADMIN_PAGE_SIZE}`,
    ]);
    return {
      items: rows.map((row) => toRowOf({ row, role: query.role })),
      page: query.page,
      pageSize: ADMIN_PAGE_SIZE,
      total: Number(counted[0]?.total ?? 0),
    };
  }

  async profile({
    referrerId,
    role,
  }: {
    referrerId: string;
    role: StaffRole;
  }): Promise<AdminReferrerProfile | null> {
    const [row] = await this.db.$queryRaw<
      (RowSource & {
        created_at: Date;
        rate_percent: number;
        tax_id_type: 'cpf' | 'cnpj' | null;
        tax_id_encrypted: string | null;
      })[]
    >`
      SELECT ${ROW_COLUMNS}, r.created_at, r.rate_percent, r.tax_id_type, r.tax_id_encrypted
      ${FROM}
      WHERE r.id = ${referrerId}::uuid AND r.kind = 'planner'`;
    if (!row) return null;
    let block: AdminReferrerProfile['block'] = null;
    if (row.status === 'blocked') {
      const log = await this.db.applicationLog.findFirst({
        where: { action: 'referrer.blocked', entityType: 'referrer', entityId: referrerId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, actorUserId: true, data: true },
      });
      if (log) {
        const by = log.actorUserId
          ? await this.db.user.findUnique({
              where: { id: log.actorUserId },
              select: { id: true, name: true },
            })
          : null;
        const reason = (log.data as { reason?: unknown } | null)?.reason;
        block = {
          blockedAt: log.createdAt,
          blockedBy: by ? { userId: by.id, name: by.name } : null,
          reason: typeof reason === 'string' ? reason : null,
        };
      }
    }
    // A chave Pix mascarada é do Admin (decisão 69).
    const pixKey =
      role === 'admin'
        ? await this.db.referrerPixKey.findFirst({
            where: { referrerId, status: 'active' },
            orderBy: { activeFrom: 'desc' },
            select: { keyMasked: true },
          })
        : undefined;
    return {
      ...toRowOf({ row, role }),
      createdAt: row.created_at,
      ratePercent: row.rate_percent,
      taxIdType: row.tax_id_type,
      taxIdEncrypted: row.tax_id_encrypted,
      ...(role === 'admin' ? { pixKeyMasked: pixKey?.keyMasked ?? null } : {}),
      block,
    };
  }

  async weddings({
    referrerId,
    page,
  }: {
    referrerId: string;
    page: number;
  }): Promise<Page<AdminWeddingRow>> {
    const where = { referrerId, status: { not: 'purged' as const } };
    const [total, weddings] = await Promise.all([
      this.db.wedding.count({ where }),
      this.db.wedding.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: ROW_SELECT,
      }),
    ]);
    return { items: weddings.map(toRow), page, pageSize: ADMIN_PAGE_SIZE, total };
  }

  /** O extrato (aba Comissões): as comissões e os ajustes, do mais novo ao mais velho. */
  async statement({
    referrerId,
    page,
  }: {
    referrerId: string;
    page: number;
  }): Promise<Page<AdminReferrerStatementEntry>> {
    const [counted, rows] = await Promise.all([
      this.db.$queryRaw<{ total: bigint }[]>`
        SELECT (SELECT count(*) FROM commissions WHERE referrer_id = ${referrerId}::uuid)
             + (SELECT count(*) FROM commission_adjustments WHERE referrer_id = ${referrerId}::uuid)
          AS total`,
      this.db.$queryRaw<{ kind: 'commission' | 'adjustment'; id: string; created_at: Date }[]>`
        SELECT 'commission' AS kind, id, created_at FROM commissions
          WHERE referrer_id = ${referrerId}::uuid
        UNION ALL
        SELECT 'adjustment' AS kind, id, created_at FROM commission_adjustments
          WHERE referrer_id = ${referrerId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${STATEMENT_PAGE_SIZE} OFFSET ${(page - 1) * STATEMENT_PAGE_SIZE}`,
    ]);
    const ids = (kind: 'commission' | 'adjustment') =>
      rows.filter((row) => row.kind === kind).map((row) => row.id);
    const [commissions, adjustments] = await Promise.all([
      this.db.commission.findMany({
        where: { id: { in: ids('commission') } },
        select: {
          id: true,
          createdAt: true,
          weddingId: true,
          baseAmountCents: true,
          ratePercent: true,
          amountCents: true,
          status: true,
          blockReason: true,
          availableAt: true,
          paidAt: true,
          payoutId: true,
          payment: { select: { kind: true } },
          wedding: {
            select: {
              status: true,
              partners: { select: { slot: true, displayName: true }, orderBy: { slot: 'asc' } },
            },
          },
        },
      }),
      this.db.commissionAdjustment.findMany({
        where: { id: { in: ids('adjustment') } },
        select: {
          id: true,
          createdAt: true,
          reason: true,
          amountCents: true,
          note: true,
          commissionId: true,
          payoutId: true,
          createdBy: { select: { id: true, name: true } },
        },
      }),
    ]);
    const byId = new Map<string, AdminReferrerStatementEntry>();
    for (const commission of commissions) {
      const purged = commission.wedding.status === 'purged';
      const [first, second] = commission.wedding.partners;
      byId.set(commission.id, {
        kind: 'commission',
        id: commission.id,
        createdAt: commission.createdAt,
        weddingId: purged ? null : commission.weddingId,
        coupleNames: purged
          ? null
          : partnerNames(first?.displayName ?? null, second?.displayName ?? null) || null,
        paymentKind: commission.payment.kind,
        baseAmountCents: commission.baseAmountCents,
        ratePercent: commission.ratePercent,
        amountCents: commission.amountCents,
        status: commission.status,
        blockReason: commission.blockReason,
        availableAt: commission.availableAt,
        paidAt: commission.paidAt,
        payoutId: commission.payoutId,
      });
    }
    for (const adjustment of adjustments)
      byId.set(adjustment.id, {
        kind: 'adjustment',
        id: adjustment.id,
        createdAt: adjustment.createdAt,
        reason: adjustment.reason,
        amountCents: adjustment.amountCents,
        note: adjustment.note,
        commissionId: adjustment.commissionId,
        payoutId: adjustment.payoutId,
        createdBy: adjustment.createdBy
          ? { userId: adjustment.createdBy.id, name: adjustment.createdBy.name }
          : null,
      });
    return {
      items: rows.flatMap((row) => byId.get(row.id) ?? []),
      page,
      pageSize: STATEMENT_PAGE_SIZE,
      total: Number(counted[0]?.total ?? 0),
    };
  }

  async payouts({
    referrerId,
    page,
  }: {
    referrerId: string;
    page: number;
  }): Promise<Page<AdminReferrerPayout>> {
    const where = { referrerId };
    const [total, payouts] = await Promise.all([
      this.db.payout.count({ where }),
      this.db.payout.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ADMIN_PAGE_SIZE,
        take: ADMIN_PAGE_SIZE,
        select: {
          id: true,
          status: true,
          holdReason: true,
          amountCents: true,
          pixKeyMasked: true,
          requestedAt: true,
          processingAt: true,
          paidAt: true,
          rejectedAt: true,
          rejectReason: true,
        },
      }),
    ]);
    return { items: payouts, page, pageSize: ADMIN_PAGE_SIZE, total };
  }
}
