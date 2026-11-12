import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type {
  LockedPlannerDigest,
  PlannerDigestChange,
  PlannerDigestStore,
  PlannerDigestWedding,
} from '../../application/ports/planner-digest-store.port';
import { partnerNamesOf, recipientRole } from './notification-recipient';

/** O envio cabe na transação (o SMTP aceita em segundos). */
const SEND_TRANSACTION_TIMEOUT_MS = 30_000;

/** Pela conexão do backoffice (sem RLS): a conferência do vínculo é explícita (D18). */
@Injectable()
export class PrismaPlannerDigestStore implements PlannerDigestStore {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async candidates(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT n.user_id::text AS user_id
      FROM notifications n
      JOIN referrers r ON r.user_id = n.user_id AND r.kind = 'planner' AND r.status = 'active'
      JOIN planners p ON p.referrer_id = r.id
      LEFT JOIN notification_email_states s
        ON s.user_id = n.user_id AND s.wedding_id = n.wedding_id
      WHERE n.type IN ('rsvp', 'wedding_published')
        AND (s.emailed_through IS NULL OR n.updated_at > s.emailed_through)
        AND NOT EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = n.user_id AND m.wedding_id = n.wedding_id
            AND m.role = 'owner' AND m.removed_at IS NULL)`;
    return rows.map((row) => row.user_id);
  }

  async withLockedDigest({
    userId,
    work,
  }: {
    userId: string;
    work: (state: LockedPlannerDigest) => Promise<PlannerDigestChange | null>;
  }): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO notification_digest_states (user_id, updated_at)
          VALUES (${userId}::uuid, now())
          ON CONFLICT (user_id) DO NOTHING`;
        const [state] = await tx.$queryRaw<{ last_digest_date: string | null }[]>`
          SELECT to_char(last_digest_date, 'YYYY-MM-DD') AS last_digest_date
          FROM notification_digest_states WHERE user_id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true, name: true },
        });
        const preferences = await tx.notificationPreference.findMany({
          where: { userId, weddingId: null, type: { in: ['rsvp', 'wedding_published'] } },
          select: { type: true, email: true },
        });
        const notifications = await tx.notification.findMany({
          where: { userId, type: { in: ['rsvp', 'wedding_published'] } },
          select: { weddingId: true, type: true, payload: true, updatedAt: true },
        });
        const states = await tx.notificationEmailState.findMany({
          where: { userId, weddingId: { in: [...new Set(notifications.map((n) => n.weddingId))] } },
          select: { weddingId: true, emailedThrough: true },
        });
        const weddings: PlannerDigestWedding[] = [];
        for (const weddingId of new Set(notifications.map((n) => n.weddingId))) {
          const emailedThrough =
            states.find((state) => state.weddingId === weddingId)?.emailedThrough ?? null;
          const fresh = notifications.filter(
            (n) => n.weddingId === weddingId && (!emailedThrough || n.updatedAt > emailedThrough),
          );
          if (fresh.length === 0) continue;
          // D18: na hora de mandar, a colaboração ativa (respostas e publicação)
          // ou a indicação (só a publicação). O casamento de que é dona fica de fora.
          const role = await recipientRole({ db: tx, userId, weddingId });
          if (role === 'owner') continue;
          const referrer =
            role === 'planner'
              ? false
              : (await tx.wedding.count({
                  where: {
                    id: weddingId,
                    referrer: { userId, kind: 'planner', status: 'active' },
                  },
                })) > 0;
          const published = fresh.find((n) => n.type === 'wedding_published');
          weddings.push({
            weddingId,
            partnerNames: await partnerNamesOf({ db: tx, weddingId }),
            emailedThrough,
            rsvpPayloads:
              role === 'planner'
                ? fresh.filter((n) => n.type === 'rsvp').map((n) => n.payload)
                : [],
            publishedAt: published && (role === 'planner' || referrer) ? published.updatedAt : null,
          });
        }
        const frequency = (type: string) =>
          preferences.find((preference) => preference.type === type)?.email ?? 'daily';
        const change = await work({
          email: user.email,
          firstName: user.name?.trim().split(/\s+/)[0] || null,
          lastDigestDate: state.last_digest_date,
          rsvpFrequency: frequency('rsvp'),
          publishedFrequency: frequency('wedding_published'),
          weddings,
        });
        if (!change) return;
        await tx.notificationDigestState.update({
          where: { userId },
          data: { lastDigestDate: new Date(`${change.lastDigestDate}T00:00:00Z`) },
        });
        for (const cursor of change.cursors)
          await tx.notificationEmailState.upsert({
            where: { userId_weddingId: { userId, weddingId: cursor.weddingId } },
            create: { userId, weddingId: cursor.weddingId, emailedThrough: cursor.emailedThrough },
            update: { emailedThrough: cursor.emailedThrough },
          });
      },
      { timeout: SEND_TRANSACTION_TIMEOUT_MS },
    );
  }
}
