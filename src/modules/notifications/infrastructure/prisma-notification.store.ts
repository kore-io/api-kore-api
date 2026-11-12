import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type {
  EmailFrequency,
  NotificationRow,
  NotificationStore,
  NotificationType,
  PreferenceRow,
} from '../application/ports/notification-store.port';

const PREFERENCE_SELECT = { type: true, inApp: true, email: true, push: true } as const;

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaNotificationStore implements NotificationStore {
  constructor(private readonly tenant: TenantTransaction) {}

  list({
    userId,
    weddingId,
    type,
    after,
    limit,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType | null;
    after: { updatedAt: Date; id: string } | null;
    limit: number;
  }): Promise<NotificationRow[]> {
    return this.tenant.client().notification.findMany({
      where: {
        userId,
        weddingId,
        ...(type ? { type } : {}),
        ...(after
          ? {
              OR: [
                { updatedAt: { lt: after.updatedAt } },
                { updatedAt: after.updatedAt, id: { lt: after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, type: true, count: true, payload: true, readAt: true, updatedAt: true },
    });
  }

  unreadCount({ userId, weddingId }: { userId: string; weddingId: string }): Promise<number> {
    return this.tenant.client().notification.count({
      where: { userId, weddingId, readAt: null },
    });
  }

  async markRead({ userId, id, now }: { userId: string; id: string; now: Date }): Promise<boolean> {
    const tx = this.tenant.client();
    const found = await tx.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!found) return false;
    await tx.notification.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
    return true;
  }

  async markAllRead({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<void> {
    await this.tenant.client().notification.updateMany({
      where: { userId, weddingId, readAt: null },
      data: { readAt: now },
    });
  }

  preferences({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<PreferenceRow[]> {
    return this.tenant.client().notificationPreference.findMany({
      where: { userId, weddingId },
      select: PREFERENCE_SELECT,
    });
  }

  saveEmailPreference({
    userId,
    weddingId,
    type,
    email,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow> {
    return this.tenant.client().notificationPreference.upsert({
      where: { userId_weddingId_type: { userId, weddingId, type } },
      create: { userId, weddingId, type, email },
      update: { email },
      select: PREFERENCE_SELECT,
    });
  }

  async hasPushSubscription({ sessionId }: { sessionId: string }): Promise<boolean> {
    return (await this.tenant.client().pushSubscription.count({ where: { sessionId } })) > 0;
  }
}
