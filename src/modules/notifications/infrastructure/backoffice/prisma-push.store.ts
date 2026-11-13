import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type { PushStore, StoredPushSubscription } from '../../application/ports/push-store.port';
import { partnerNamesOf, preferenceWhere, recipientRole } from './notification-recipient';

/** Pela conexão do backoffice (sem RLS): o worker atravessa as pessoas. */
@Injectable()
export class PrismaPushStore implements PushStore {
  constructor(private readonly prisma: BackofficePrismaService) {}

  async recipient({
    userId,
    weddingId,
    type,
    now,
  }: {
    userId: string;
    weddingId: string;
    type: 'rsvp' | 'billing';
    now: Date;
  }): ReturnType<PushStore['recipient']> {
    const found = await recipientRole({ db: this.prisma, userId, weddingId });
    // A cobrança é só das pessoas donas (Publicar e pagar RN13).
    const role = type === 'billing' && found !== 'owner' ? null : found;
    const [preference, subscriptions, notification] = await Promise.all([
      role
        ? this.prisma.notificationPreference.findFirst({
            where: preferenceWhere({ role, userId, weddingId, type }),
            select: { push: true },
          })
        : null,
      this.prisma.pushSubscription.findMany({
        where: { userId },
        select: {
          id: true,
          endpoint: true,
          p256dh: true,
          auth: true,
          session: { select: { revokedAt: true, expiresAt: true } },
        },
      }),
      this.prisma.notification.findFirst({
        where: { userId, weddingId, type, readAt: null },
        orderBy: { updatedAt: 'desc' },
        select: { groupKey: true, count: true, payload: true },
      }),
    ]);
    const first = Array.isArray(notification?.payload)
      ? (notification.payload as { name?: string }[])[0]
      : undefined;
    return {
      member: role !== null,
      role,
      partnerNames:
        role === 'planner' ? await partnerNamesOf({ db: this.prisma, weddingId }) : ['', ''],
      push: preference?.push ?? false,
      subscriptions: subscriptions.map(({ session, ...subscription }): StoredPushSubscription => ({
        ...subscription,
        sessionActive: session.revokedAt === null && session.expiresAt > now,
      })),
      notification: notification
        ? {
            groupKey: notification.groupKey,
            count: notification.count,
            firstGroupName: first?.name ?? null,
          }
        : null,
    };
  }

  async remove({ ids }: { ids: readonly string[] }): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushSubscription.deleteMany({ where: { id: { in: [...ids] } } });
  }

  async markSuccess({ ids, now }: { ids: readonly string[]; now: Date }): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushSubscription.updateMany({
      where: { id: { in: [...ids] } },
      data: { lastSuccessAt: now },
    });
  }
}
