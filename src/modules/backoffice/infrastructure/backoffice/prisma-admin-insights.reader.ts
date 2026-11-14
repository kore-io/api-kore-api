import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import type {
  AdminAlertRow,
  AdminInsightsReader,
  AdminLogQuery,
  AdminLogRow,
  AdminOverview,
  AdminSearchResult,
  MonthPoint,
} from '../../application/ports/admin-insights.reader.port';
import type { Page } from '../../application/ports/admin-weddings.reader.port';
import type { StaffRole } from '../../domain/staff';
import { ROW_SELECT, toRow } from './prisma-admin-weddings.reader';

const TZ = 'America/Sao_Paulo';
const LOG_PAGE_SIZE = 50;
const ALERT_PAGE_SIZE = 50;
const SEARCH_LIMIT = 10;
const IP_HASH_SHORT = 8;

const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';
const num = (value: unknown) => Number(value ?? 0);

/** Pela conexão do backoffice (decisão 180(5)). */
@Injectable()
export class PrismaAdminInsightsReader implements AdminInsightsReader {
  constructor(private readonly db: BackofficePrismaService) {}

  /**
   * Consultas agregadas por mês, em Brasília (RN04), nunca a tabela inteira
   * linha a linha; quem chama guarda o resultado por 5 minutos.
   */
  async overview({ role, now }: { role: StaffRole; now: Date }): Promise<AdminOverview> {
    const [bounds] = await this.db.$queryRaw<
      { monthStart: Date; month: string; yearStart: Date }[]
    >`
      SELECT (date_trunc('month', ${now}::timestamptz AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}) AS "monthStart",
             to_char(${now}::timestamptz AT TIME ZONE ${TZ}, 'YYYY-MM') AS month,
             ((date_trunc('month', ${now}::timestamptz AT TIME ZONE ${TZ}) - interval '11 months')
               AT TIME ZONE ${TZ}) AS "yearStart"`;
    const { monthStart, yearStart } = bounds;
    const [counts] = await this.db.$queryRaw<
      {
        created: bigint;
        published: bigint;
        plannersActive: bigint;
        plannersNew: bigint;
        rsvpAverage: string | null;
      }[]
    >`
      SELECT
        (SELECT count(*) FROM weddings WHERE created_at >= ${monthStart}) AS created,
        (SELECT count(*) FROM weddings WHERE published_at >= ${monthStart}) AS published,
        (SELECT count(*) FROM referrers WHERE kind = 'planner' AND status = 'active') AS "plannersActive",
        (SELECT count(*) FROM referrers WHERE kind = 'planner' AND created_at >= ${monthStart}) AS "plannersNew",
        (SELECT round(avg(s.rsvp_percent), 1)::text FROM wedding_stats s
           JOIN weddings w ON w.id = s.wedding_id
          WHERE s.guests_total > 0 AND w.status IN ('published', 'post_event', 'grace')
            AND w.blocked_at IS NULL) AS "rsvpAverage"`;
    const moneyAlerts = role === 'admin';
    const [alerts] = await this.db.$queryRaw<{ open: bigint }[]>`
      SELECT count(*) AS open FROM alerts
      WHERE status = 'open'
        AND (${moneyAlerts} OR type::text NOT IN (
          'orphan_payment', 'gateway_amount_mismatch', 'refund_failed', 'payment_disputed',
          'dispute_lost', 'repeated_refund', 'payout_failed', 'manual_adjustment',
          'pix_key_churn', 'webhook_failure'))`;
    const series = (rows: { month: string; value: unknown }[]): MonthPoint[] =>
      rows.map((row) => ({ month: row.month, value: num(row.value) }));
    // A coluna vem de uma lista fechada no código, nunca de entrada.
    const months = (column: Prisma.Sql) => this.db.$queryRaw<{ month: string; value: bigint }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month,
             (SELECT count(*) FROM weddings
               WHERE ${column} >= (m AT TIME ZONE ${TZ})
                 AND ${column} < ((m + interval '1 month') AT TIME ZONE ${TZ})) AS value
      FROM generate_series(date_trunc('month', ${yearStart}::timestamptz AT TIME ZONE ${TZ}),
                           date_trunc('month', ${now}::timestamptz AT TIME ZONE ${TZ}),
                           interval '1 month') AS m
      ORDER BY m`;
    const created = series(await months(Prisma.raw('created_at')));
    const published = series(await months(Prisma.raw('published_at')));
    const created_ = num(counts.created);
    const overview: AdminOverview = {
      month: bounds.month,
      weddingsCreated: created_,
      weddingsPublished: num(counts.published),
      activationPercent:
        created_ > 0 ? Math.round((num(counts.published) / created_) * 1000) / 10 : null,
      plannersActive: num(counts.plannersActive),
      plannersNew: num(counts.plannersNew),
      rsvpAveragePercent: counts.rsvpAverage === null ? null : Number(counts.rsvpAverage),
      openAlerts: num(alerts.open),
      charts: { created, published },
    };
    if (role !== 'admin') return overview;

    // Sem os juros do cartão e sem cortesia (que não é pagamento): só os aplicados (decisão 79).
    const [revenue] = await this.db.$queryRaw<{ publications: bigint; extensions: bigint }[]>`
      SELECT coalesce(sum(amount_cents - installment_interest_cents)
                        FILTER (WHERE kind = 'publication'), 0) AS publications,
             coalesce(sum(amount_cents - installment_interest_cents)
                        FILTER (WHERE kind = 'extension'), 0) AS extensions
      FROM payments WHERE applied_at >= ${monthStart}`;
    const revenueMonths = await this.db.$queryRaw<{ month: string; value: bigint }[]>`
      SELECT to_char(m, 'YYYY-MM') AS month,
             (SELECT coalesce(sum(amount_cents - installment_interest_cents), 0) FROM payments
               WHERE applied_at >= (m AT TIME ZONE ${TZ})
                 AND applied_at < ((m + interval '1 month') AT TIME ZONE ${TZ})) AS value
      FROM generate_series(date_trunc('month', ${yearStart}::timestamptz AT TIME ZONE ${TZ}),
                           date_trunc('month', ${now}::timestamptz AT TIME ZONE ${TZ}),
                           interval '1 month') AS m
      ORDER BY m`;
    const [payouts] = await this.db.$queryRaw<{ count: bigint; amount: bigint }[]>`
      SELECT count(*) AS count, coalesce(sum(amount_cents), 0) AS amount
      FROM payouts WHERE status = 'requested'`;
    return {
      ...overview,
      charts: { ...overview.charts, revenueCents: series(revenueMonths) },
      revenue: {
        publicationsCents: num(revenue.publications),
        extensionsCents: num(revenue.extensions),
      },
      payoutsRequested: { count: num(payouts.count), amountCents: num(payouts.amount) },
    };
  }

  /** Casal, slug, e-mail de quem tem acesso; indicador por nome, e-mail ou código (RN03). */
  async search({ term }: { term: string }): Promise<AdminSearchResult> {
    const contains = { contains: term, mode: 'insensitive' as const };
    const [weddings, referrers] = await Promise.all([
      this.db.wedding.findMany({
        where: {
          status: { not: 'purged' },
          OR: [
            { slug: contains },
            { partners: { some: { displayName: contains } } },
            {
              memberships: { some: { removedAt: null, user: { email: contains } } },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SEARCH_LIMIT,
        select: ROW_SELECT,
      }),
      this.db.referrer.findMany({
        where: {
          OR: [
            { referralCode: contains },
            { user: { email: contains } },
            { user: { name: contains } },
            { planner: { creditName: contains } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SEARCH_LIMIT,
        select: {
          id: true,
          kind: true,
          status: true,
          referralCode: true,
          user: { select: { name: true } },
          planner: { select: { creditName: true } },
        },
      }),
    ]);
    return {
      weddings: weddings.map(toRow),
      referrers: referrers.map((referrer) => ({
        id: referrer.id,
        kind: referrer.kind,
        name: referrer.planner?.creditName ?? referrer.user.name ?? '',
        referralCode: referrer.referralCode,
        status: referrer.status,
      })),
    };
  }

  async logs(query: AdminLogQuery): Promise<Page<AdminLogRow>> {
    const where: Prisma.ApplicationLogWhereInput = {
      createdAt: { gte: query.from, lte: query.to },
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { actorUserId: query.userId } : {}),
      ...(query.weddingId ? { weddingId: query.weddingId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.applicationLog.count({ where }),
      this.db.applicationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * LOG_PAGE_SIZE,
        take: LOG_PAGE_SIZE,
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        action: row.action,
        actorKind: row.actorKind,
        actorUserId: row.actorUserId,
        weddingId: row.weddingId,
        supportSessionId: row.supportSessionId,
        entityType: row.entityType,
        entityId: row.entityId,
        data: row.data,
        ipHashShort: row.ipHash ? row.ipHash.slice(0, IP_HASH_SHORT) : null,
      })),
      page: query.page,
      pageSize: LOG_PAGE_SIZE,
      total,
    };
  }

  async alerts({
    status,
    types,
    page,
  }: {
    status: 'open' | 'resolved';
    types: string[];
    page: number;
  }): Promise<Page<AdminAlertRow> & { openCount: number }> {
    const typeFilter = { type: { in: types as Prisma.EnumAlertTypeFilter['in'] } };
    const where: Prisma.AlertWhereInput = { status, ...typeFilter };
    const [total, openCount, rows] = await Promise.all([
      this.db.alert.count({ where }),
      this.db.alert.count({ where: { status: 'open', ...typeFilter } }),
      this.db.alert.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * ALERT_PAGE_SIZE,
        take: ALERT_PAGE_SIZE,
      }),
    ]);
    const weddingIds = [...new Set(rows.flatMap((row) => (row.weddingId ? [row.weddingId] : [])))];
    const resolverIds = [
      ...new Set(rows.flatMap((row) => (row.resolvedByUserId ? [row.resolvedByUserId] : []))),
    ];
    const [partners, resolvers] = await Promise.all([
      this.db.partner.findMany({
        where: { weddingId: { in: weddingIds } },
        orderBy: { slot: 'asc' },
        select: { weddingId: true, displayName: true },
      }),
      this.db.user.findMany({
        where: { id: { in: resolverIds } },
        select: { id: true, name: true },
      }),
    ]);
    const couple = new Map<string, string[]>();
    for (const partner of partners)
      couple.set(partner.weddingId, [
        ...(couple.get(partner.weddingId) ?? []),
        firstName(partner.displayName),
      ]);
    const resolverName = new Map(resolvers.map((user) => [user.id, user.name] as const));
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        createdAt: row.createdAt,
        weddingId: row.weddingId,
        coupleNames: row.weddingId ? (couple.get(row.weddingId)?.join(' & ') ?? null) : null,
        userId: row.userId,
        entityType: row.entityType,
        entityId: row.entityId,
        data: row.data,
        resolvedAt: row.resolvedAt,
        resolvedByName: row.resolvedByUserId
          ? (resolverName.get(row.resolvedByUserId) ?? null)
          : null,
      })),
      page,
      pageSize: ALERT_PAGE_SIZE,
      total,
      openCount,
    };
  }

  resolveAlert({
    alertId,
    types,
    byUserId,
    now,
  }: {
    alertId: string;
    types: string[];
    byUserId: string;
    now: Date;
  }): Promise<'resolved' | 'already_resolved' | 'not_found'> {
    return this.db.$transaction(async (tx) => {
      const [alert] = await tx.$queryRaw<
        { status: string; type: string; weddingId: string | null }[]
      >`
        SELECT status::text AS status, type::text AS type, wedding_id::text AS "weddingId"
        FROM alerts WHERE id = ${alertId}::uuid FOR UPDATE`;
      if (!alert || !types.includes(alert.type)) return 'not_found';
      if (alert.status !== 'open') return 'already_resolved';
      await tx.alert.update({
        where: { id: alertId },
        data: { status: 'resolved', resolvedAt: now, resolvedByUserId: byUserId },
      });
      await tx.applicationLog.create({
        data: {
          id: uuidV7({ now: now.getTime() }),
          createdAt: now,
          action: 'alert.resolved',
          actorKind: 'admin',
          actorUserId: byUserId,
          weddingId: alert.weddingId,
          entityType: 'alert',
          entityId: alertId,
          data: { type: alert.type },
        },
      });
      return 'resolved';
    });
  }
}
