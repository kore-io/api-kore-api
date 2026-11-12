import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '../../../shared/database/tenant-transaction';
import type { PushSubscriptionStore } from '../application/ports/push-subscription-store.port';

/** Na transação da requisição, com a RLS ligada (só as da própria pessoa). */
@Injectable()
export class PrismaPushSubscriptionStore implements PushSubscriptionStore {
  constructor(private readonly tenant: TenantTransaction) {}

  async save({
    userId,
    sessionId,
    endpoint,
    p256dh,
    auth,
    userAgent,
  }: {
    userId: string;
    sessionId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<void> {
    const tx = this.tenant.client();
    await tx.$executeRaw`SELECT release_push_endpoint(${endpoint})`;
    await tx.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, sessionId, endpoint, p256dh, auth, userAgent },
      update: { sessionId, p256dh, auth, userAgent },
      select: { id: true },
    });
  }

  async remove({ userId, endpoint }: { userId: string; endpoint: string }): Promise<number> {
    const tx = this.tenant.client();
    await tx.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return tx.pushSubscription.count({ where: { userId } });
  }

  async setPushPreference({ userId, push }: { userId: string; push: boolean }): Promise<void> {
    const tx = this.tenant.client();
    const memberships = await tx.membership.findMany({
      where: { userId, removedAt: null },
      select: { weddingId: true },
    });
    for (const { weddingId } of memberships)
      await tx.notificationPreference.upsert({
        where: { userId_weddingId_type: { userId, weddingId, type: 'rsvp' } },
        create: { userId, weddingId, type: 'rsvp', push },
        update: { push },
        select: { id: true },
      });
  }
}
