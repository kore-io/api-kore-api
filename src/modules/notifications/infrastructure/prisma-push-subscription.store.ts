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
      select: { weddingId: true, role: true },
    });
    // O push é por aparelho: liga e desliga a resposta e, nos casamentos de que
    // a pessoa é dona, a cobrança junto (decisão 236; a cobrança é só das donas).
    for (const { weddingId, role } of memberships)
      for (const type of role === 'owner' ? (['rsvp', 'billing'] as const) : (['rsvp'] as const))
        await tx.notificationPreference.upsert({
          where: { userId_weddingId_type: { userId, weddingId, type } },
          create: { userId, weddingId, type, push },
          update: { push },
          select: { id: true },
        });
  }
}
