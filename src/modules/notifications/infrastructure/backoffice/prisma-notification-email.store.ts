import { Prisma } from '../../../../generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import { DEFAULT_TIMEZONE } from '../../../../shared/time/local-date';
import type {
  EmailCandidate,
  EmailStateChange,
  LockedEmailState,
  NotificationEmailStore,
} from '../../application/ports/notification-email-store.port';
import type { EmailFrequency } from '../../application/ports/notification-store.port';
import { partnerNamesOf, preferenceWhere, recipientRole } from './notification-recipient';

/** O envio de e-mail cabe na transação (o SMTP aceita em segundos). */
const SEND_TRANSACTION_TIMEOUT_MS = 30_000;

/** Pela conexão do backoffice (sem RLS): o worker atravessa os casamentos. */
@Injectable()
export class PrismaNotificationEmailStore implements NotificationEmailStore {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async withLockedState({
    userId,
    weddingId,
    work,
  }: {
    userId: string;
    weddingId: string;
    work: (state: LockedEmailState) => Promise<EmailStateChange | null>;
  }): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO notification_email_states (user_id, wedding_id, updated_at)
          VALUES (${userId}::uuid, ${weddingId}::uuid, now())
          ON CONFLICT (user_id, wedding_id) DO NOTHING`;
        const [state] = await tx.$queryRaw<
          {
            emailed_through: Date | null;
            last_immediate_at: Date | null;
            last_digest_date: string | null;
          }[]
        >`
          SELECT emailed_through, last_immediate_at, to_char(last_digest_date, 'YYYY-MM-DD') AS last_digest_date
          FROM notification_email_states
          WHERE user_id = ${userId}::uuid AND wedding_id = ${weddingId}::uuid FOR UPDATE`;
        const role = await recipientRole({ db: tx, userId, weddingId });
        const [user, wedding, preference, stats, notifications] = [
          await tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: { email: true, name: true },
          }),
          await tx.wedding.findUniqueOrThrow({
            where: { id: weddingId },
            select: { timezone: true },
          }),
          role
            ? await tx.notificationPreference.findFirst({
                where: preferenceWhere({ role, userId, weddingId, type: 'rsvp' }),
                select: { email: true },
              })
            : null,
          await tx.weddingStats.findUnique({
            where: { weddingId },
            select: { confirmed: true, declined: true, pending: true },
          }),
          await tx.notification.findMany({
            where: {
              userId,
              weddingId,
              type: 'rsvp',
              ...(state.emailed_through ? { updatedAt: { gt: state.emailed_through } } : {}),
            },
            select: { payload: true },
          }),
        ];
        const change = await work({
          member: role !== null,
          role,
          // Só os textos da cerimonialista levam o casal.
          partnerNames: role === 'planner' ? await partnerNamesOf({ db: tx, weddingId }) : ['', ''],
          email: user.email,
          firstName: user.name?.trim().split(/\s+/)[0] || null,
          frequency: preference?.email ?? 'daily',
          timezone: wedding.timezone ?? DEFAULT_TIMEZONE,
          emailedThrough: state.emailed_through,
          lastImmediateAt: state.last_immediate_at,
          lastDigestDate: state.last_digest_date,
          payloads: notifications.map((row) => row.payload),
          totals: stats ?? { confirmed: 0, declined: 0, pending: 0 },
        });
        if (!change) return;
        await tx.notificationEmailState.update({
          where: { userId_weddingId: { userId, weddingId } },
          data: {
            ...(change.emailedThrough ? { emailedThrough: change.emailedThrough } : {}),
            ...(change.lastImmediateAt ? { lastImmediateAt: change.lastImmediateAt } : {}),
            ...(change.lastDigestDate
              ? { lastDigestDate: new Date(`${change.lastDigestDate}T00:00:00Z`) }
              : {}),
          },
        });
      },
      { timeout: SEND_TRANSACTION_TIMEOUT_MS },
    );
  }

  async peek({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<{ frequency: EmailFrequency; lastImmediateAt: Date | null }> {
    const role = await recipientRole({ db: this.prisma, userId, weddingId });
    const [preference, state] = await Promise.all([
      role
        ? this.prisma.notificationPreference.findFirst({
            where: preferenceWhere({ role, userId, weddingId, type: 'rsvp' }),
            select: { email: true },
          })
        : null,
      this.prisma.notificationEmailState.findUnique({
        where: { userId_weddingId: { userId, weddingId } },
        select: { lastImmediateAt: true },
      }),
    ]);
    return {
      frequency: preference?.email ?? 'daily',
      lastImmediateAt: state?.lastImmediateAt ?? null,
    };
  }

  /**
   * Só os pares que ainda podem receber: sem isso, quem desligou o e-mail ou
   * perdeu o vínculo ficaria na lista para sempre (a lista só cresceria). O
   * dono, com a preferência do casamento ligada; a cerimonialista com Planner,
   * só com a geral em "Na hora" (o resumo dela é o agrupado, no PlannerDigest).
   * O envio confere tudo de novo, travado (D18).
   */
  candidates({ weddingId }: { weddingId?: string } = {}): Promise<EmailCandidate[]> {
    const only = weddingId ? Prisma.sql`AND n.wedding_id = ${weddingId}::uuid` : Prisma.empty;
    return this.prisma.$queryRaw<EmailCandidate[]>`
      SELECT DISTINCT n.user_id::text AS "userId", n.wedding_id::text AS "weddingId"
      FROM notifications n
      JOIN memberships m
        ON m.user_id = n.user_id AND m.wedding_id = n.wedding_id AND m.removed_at IS NULL
      LEFT JOIN notification_email_states s
        ON s.user_id = n.user_id AND s.wedding_id = n.wedding_id
      WHERE n.type = 'rsvp' ${only}
        AND (s.emailed_through IS NULL OR n.updated_at > s.emailed_through)
        AND (
          (m.role = 'owner' AND COALESCE((
            SELECT p.email::text FROM notification_preferences p
            WHERE p.user_id = n.user_id AND p.wedding_id = n.wedding_id AND p.type = 'rsvp'
          ), 'daily') <> 'off')
          OR (m.role = 'collaborator'
            AND EXISTS (
              SELECT 1 FROM referrers r JOIN planners pl ON pl.referrer_id = r.id
              WHERE r.user_id = n.user_id AND r.kind = 'planner' AND r.status = 'active')
            AND (
              SELECT p.email::text FROM notification_preferences p
              WHERE p.user_id = n.user_id AND p.wedding_id IS NULL AND p.type = 'rsvp'
            ) = 'immediate'))`;
  }

  async closeQuietDigests({
    now,
    skip,
    weddingId,
  }: {
    now: Date;
    skip: readonly EmailCandidate[];
    weddingId?: string;
  }): Promise<number> {
    const only = weddingId ? Prisma.sql`AND w.id = ${weddingId}::uuid` : Prisma.empty;
    const skipUsers = skip.map((pair) => pair.userId);
    const skipWeddings = skip.map((pair) => pair.weddingId);
    return this.prisma.$executeRaw`
      INSERT INTO notification_email_states (user_id, wedding_id, updated_at, last_digest_date)
      SELECT m.user_id, m.wedding_id, now(), (${now}::timestamptz AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo'))::date
      FROM memberships m
      JOIN weddings w ON w.id = m.wedding_id
      WHERE m.role = 'owner' AND m.removed_at IS NULL ${only}
        AND w.status IN ('published', 'post_event', 'grace')
        AND extract(hour FROM ${now}::timestamptz AT TIME ZONE COALESCE(w.timezone, 'America/Sao_Paulo')) >= 20
        AND COALESCE((
          SELECT p.email::text FROM notification_preferences p
          WHERE p.user_id = m.user_id AND p.wedding_id = m.wedding_id AND p.type = 'rsvp'
        ), 'daily') = 'daily'
        AND NOT EXISTS (
          SELECT 1 FROM unnest(${skipUsers}::uuid[], ${skipWeddings}::uuid[]) AS f(u, w2)
          WHERE f.u = m.user_id AND f.w2 = m.wedding_id)
      ON CONFLICT (user_id, wedding_id) DO UPDATE
        SET last_digest_date = EXCLUDED.last_digest_date, updated_at = now()
        WHERE notification_email_states.last_digest_date IS DISTINCT FROM EXCLUDED.last_digest_date`;
  }
}
