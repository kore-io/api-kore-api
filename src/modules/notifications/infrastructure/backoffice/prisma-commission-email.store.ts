import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type {
  CommissionEmailStore,
  LockedCommissionEmail,
} from '../../application/ports/commission-email-store.port';

/** O envio cabe na transação (o SMTP aceita em segundos). */
const SEND_TRANSACTION_TIMEOUT_MS = 30_000;

/** Pela conexão do backoffice (sem RLS): o worker atravessa as pessoas. */
@Injectable()
export class PrismaCommissionEmailStore implements CommissionEmailStore {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async dailyCandidates(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT n.user_id::text AS user_id
      FROM notifications n
      LEFT JOIN notification_digest_states s ON s.user_id = n.user_id
      WHERE n.type = 'commission'
        AND (s.commission_emailed_through IS NULL OR n.created_at > s.commission_emailed_through)
        AND COALESCE((
          SELECT np.email::text FROM notification_preferences np
          WHERE np.user_id = n.user_id AND np.wedding_id IS NULL AND np.type = 'commission'
        ), 'daily') = 'daily'`;
    return rows.map((row) => row.user_id);
  }

  async withLockedState({
    userId,
    work,
  }: {
    userId: string;
    work: (state: LockedCommissionEmail) => Promise<Date | null>;
  }): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          INSERT INTO notification_digest_states (user_id, updated_at)
          VALUES (${userId}::uuid, now())
          ON CONFLICT (user_id) DO NOTHING`;
        const [state] = await tx.$queryRaw<{ commission_emailed_through: Date | null }[]>`
          SELECT commission_emailed_through FROM notification_digest_states
          WHERE user_id = ${userId}::uuid FOR UPDATE`;
        const through = state?.commission_emailed_through ?? null;
        const [user, preference, newest] = await Promise.all([
          tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } }),
          tx.notificationPreference.findFirst({
            where: { userId, weddingId: null, type: 'commission' },
            select: { email: true },
          }),
          tx.notification.findFirst({
            where: {
              userId,
              type: 'commission',
              ...(through ? { createdAt: { gt: through } } : {}),
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);
        const cursor = await work({
          email: user.email,
          firstName: user.name?.trim().split(/\s+/)[0] || null,
          frequency: preference?.email ?? 'daily',
          newestPendingAt: newest?.createdAt ?? null,
        });
        if (cursor)
          await tx.notificationDigestState.update({
            where: { userId },
            data: { commissionEmailedThrough: cursor },
          });
      },
      { timeout: SEND_TRANSACTION_TIMEOUT_MS },
    );
  }
}
