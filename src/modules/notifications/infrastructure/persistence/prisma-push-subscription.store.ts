import { Injectable } from '@nestjs/common';
import { TenantTransaction } from '@/shared/database/tenant-transaction';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import type { PushSubscriptionStore } from '@/modules/notifications/application/ports/push-subscription-store.port';

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
    // A cerimonialista recebe as respostas dos casamentos em que colabora pela
    // preferência geral (Notificações da cerimonialista RN06 e RN07): o switch
    // deste aparelho liga e desliga também a linha geral de Novas respostas.
    // Só a rsvp: a publicação e a colaboração encerrada não têm push (RN06).
    const planner = await tx.referrer.findFirst({
      where: { userId, kind: 'planner', status: 'active', planner: { isNot: null } },
      select: { id: true },
    });
    if (!planner) return;
    // O índice único da linha geral é parcial (weddingId nulo): o upsert do
    // Prisma não serve. ON CONFLICT no índice parcial: dois aparelhos ligando
    // ao mesmo tempo não esbarram no único (sugestão do Crivo; decisão 310(2)).
    await tx.$executeRaw`
      INSERT INTO notification_preferences (id, user_id, wedding_id, type, push, updated_at)
      VALUES (${uuidV7()}::uuid, ${userId}::uuid, NULL, 'rsvp', ${push}, now())
      ON CONFLICT (user_id, type) WHERE wedding_id IS NULL
      DO UPDATE SET push = EXCLUDED.push, updated_at = now()`;
  }
}
