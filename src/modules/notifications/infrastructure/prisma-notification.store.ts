import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import {
  NOTIFICATION_TYPES,
  type EmailFrequency,
  type NotificationRow,
  type NotificationStore,
  type NotificationType,
  type PreferenceRow,
} from '../application/ports/notification-store.port';

const PREFERENCE_SELECT = { type: true, inApp: true, email: true, push: true } as const;
/**
 * A central do casal mostra só os tipos dela; os da cerimonialista (F6) ficam
 * de fora até a central da cerimonialista (Notificações da cerimonialista RN05).
 */
const COUPLE_TYPES = { in: [...NOTIFICATION_TYPES] };

function isCoupleType(type: string): type is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** Estreita o tipo do banco aos da central do casal (já filtrados no where). */
function coupleRows<T extends { type: string }>(rows: T[]): (T & { type: NotificationType })[] {
  return rows.filter((row): row is T & { type: NotificationType } => isCoupleType(row.type));
}

/** Na transação da requisição, com a RLS ligada. */
@Injectable()
export class PrismaNotificationStore implements NotificationStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async list({
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
    const rows = await this.tenant.client().notification.findMany({
      where: {
        userId,
        weddingId,
        type: type ?? COUPLE_TYPES,
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
    return coupleRows(rows);
  }

  unreadCount({ userId, weddingId }: { userId: string; weddingId: string }): Promise<number> {
    return this.tenant.client().notification.count({
      where: { userId, weddingId, type: COUPLE_TYPES, readAt: null },
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
      where: { userId, weddingId, type: COUPLE_TYPES, readAt: null },
      data: { readAt: now },
    });
  }

  async preferences({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<PreferenceRow[]> {
    const rows = await this.tenant.client().notificationPreference.findMany({
      where: { userId, weddingId, type: COUPLE_TYPES },
      select: PREFERENCE_SELECT,
    });
    return coupleRows(rows);
  }

  async saveEmailPreference({
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
    const row = await this.tenant.client().notificationPreference.upsert({
      where: { userId_weddingId_type: { userId, weddingId, type } },
      create: { userId, weddingId, type, email },
      update: { email },
      select: PREFERENCE_SELECT,
    });
    return { ...row, type };
  }

  async hasPushSubscription({ sessionId }: { sessionId: string }): Promise<boolean> {
    return (await this.tenant.client().pushSubscription.count({ where: { sessionId } })) > 0;
  }
}
