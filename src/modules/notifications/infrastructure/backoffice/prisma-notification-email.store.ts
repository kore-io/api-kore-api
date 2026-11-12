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

  candidates(): Promise<EmailCandidate[]> {
    return this.prisma.$queryRaw<EmailCandidate[]>`
      SELECT DISTINCT n.user_id::text AS "userId", n.wedding_id::text AS "weddingId"
      FROM notifications n
      LEFT JOIN notification_email_states s
        ON s.user_id = n.user_id AND s.wedding_id = n.wedding_id
      WHERE n.type = 'rsvp' AND (s.emailed_through IS NULL OR n.updated_at > s.emailed_through)`;
  }
}
