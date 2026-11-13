import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../../../shared/ids/uuid-v7';
import { DEFAULT_TIMEZONE } from '../../../../shared/time/local-date';
import type {
  DueNotice,
  WeddingLifecycleStore,
} from '../../application/ports/wedding-lifecycle.port';

/** Pela conexão do backoffice (sem RLS): a rotina atravessa os casamentos. */
@Injectable()
export class PrismaWeddingLifecycleStore implements WeddingLifecycleStore {
  constructor(private readonly prisma: BackofficePrismaService) {}

  advance({
    now,
    weddingId,
  }: {
    now: Date;
    weddingId?: string;
  }): Promise<{ grace: string[]; expired: string[] }> {
    const only = weddingId ? Prisma.sql`AND id = ${weddingId}::uuid` : Prisma.empty;
    return this.prisma.$transaction(async (tx) => {
      // Idempotente: só muda o que ainda está no estado de origem, e o log sai
      // só para as linhas devolvidas. O publicado com a endDate muito passada
      // (rotina parada) entra na carência e, se ela também passou, expira na
      // mesma rodada.
      const grace = await tx.$queryRaw<{ id: string }[]>`
        UPDATE weddings
        SET status = 'grace', grace_until = end_date + 7, updated_at = ${now}
        WHERE status IN ('published', 'post_event') AND end_date IS NOT NULL
          AND end_date < (${now}::timestamptz AT TIME ZONE coalesce(timezone, ${DEFAULT_TIMEZONE}))::date
          ${only}
        RETURNING id::text AS id`;
      // expiredAt é derivado (graceUntil + 1), não a hora da rotina (B4-7).
      const expired = await tx.$queryRaw<{ id: string }[]>`
        UPDATE weddings
        SET status = 'expired', expired_at = grace_until + 1,
            purge_at = ((grace_until + 1) + interval '6 months')::date, updated_at = ${now}
        WHERE status = 'grace' AND grace_until IS NOT NULL
          AND grace_until < (${now}::timestamptz AT TIME ZONE coalesce(timezone, ${DEFAULT_TIMEZONE}))::date
          ${only}
        RETURNING id::text AS id`;
      const logs = [
        ...grace.map(({ id }) => ({ id, action: 'wedding.grace' })),
        ...expired.map(({ id }) => ({ id, action: 'wedding.expired' })),
      ];
      if (logs.length > 0)
        await tx.applicationLog.createMany({
          data: logs.map(({ id, action }, index) => ({
            id: uuidV7({ now: now.getTime() + index }),
            createdAt: now,
            action,
            actorKind: 'system',
            weddingId: id,
            entityType: 'wedding',
            entityId: id,
          })),
        });
      return { grace: grace.map(({ id }) => id), expired: expired.map(({ id }) => id) };
    });
  }

  async dueNotices({
    now,
    limit,
    weddingId,
  }: {
    now: Date;
    limit: number;
    weddingId?: string;
  }): Promise<DueNotice[]> {
    const only = weddingId ? Prisma.sql`AND w.id = ${weddingId}::uuid` : Prisma.empty;
    // As janelas da RN03 (B4-2): o de antes quando endDate − 7 ≤ hoje ≤
    // endDate; o do 1º e do 5º dia na carência, até o graceUntil; o de
    // expirado, uma vez por endDate.
    const rows = await this.prisma.$queryRaw<
      {
        weddingId: string;
        notice: DueNotice['notice'];
        endDate: Date;
        graceUntil: Date | null;
        expiredAt: Date | null;
        eventDate: Date | null;
        timezone: string | null;
        daysLeft: number;
      }[]
    >`
      WITH local AS (
        SELECT w.id, w.status, w.end_date, w.grace_until, w.expired_at, w.event_date, w.timezone,
               (${now}::timestamptz AT TIME ZONE coalesce(w.timezone, ${DEFAULT_TIMEZONE}))::date AS today
        FROM weddings w
        WHERE w.status IN ('published', 'post_event', 'grace', 'expired')
          AND w.end_date IS NOT NULL
          AND w.blocked_at IS NULL AND w.deletion_scheduled_for IS NULL
          ${only}
      ),
      due AS (
        SELECT id, 'end_date_in_7_days'::billing_notice AS notice FROM local
        WHERE status IN ('published', 'post_event') AND end_date - 7 <= today AND today <= end_date
        UNION ALL
        SELECT id, 'grace_day_1' FROM local
        WHERE status = 'grace' AND end_date + 1 <= today AND today <= grace_until
        UNION ALL
        SELECT id, 'grace_day_5' FROM local
        WHERE status = 'grace' AND end_date + 5 <= today AND today <= grace_until
        UNION ALL
        SELECT id, 'expired' FROM local WHERE status = 'expired'
      )
      SELECT l.id::text AS "weddingId", d.notice, l.end_date AS "endDate",
             l.grace_until AS "graceUntil", l.expired_at AS "expiredAt",
             l.event_date AS "eventDate", l.timezone, (l.end_date - l.today)::int AS "daysLeft"
      FROM due d JOIN local l ON l.id = d.id
      WHERE NOT EXISTS (
        SELECT 1 FROM billing_notice_logs n
        WHERE n.wedding_id = l.id AND n.notice = d.notice AND n.end_date = l.end_date
      )
      ORDER BY l.id, d.notice
      LIMIT ${limit}`;
    const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
    return rows.map((row) => ({
      ...row,
      endDate: day(row.endDate) ?? '',
      graceUntil: day(row.graceUntil),
      expiredAt: day(row.expiredAt),
      eventDate: day(row.eventDate),
    }));
  }
}
