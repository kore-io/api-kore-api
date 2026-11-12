import type { TestingModule } from '@nestjs/testing';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  RsvpPush,
  PushRetryError,
} from '../../src/modules/notifications/application/rsvp-push.use-case';
import { PUSH_STORE } from '../../src/modules/notifications/application/ports/push-store.port';
import type {
  PushResult,
  PushTarget,
} from '../../src/modules/notifications/application/ports/push-sender.port';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

/** O push da resposta (E-mail e push RN07 a RN09; worker, com o serviço de push falso). */
describe('Push das respostas (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  /** O serviço de push: guarda o que recebeu e responde pelo endpoint. */
  function fakeSender(results: Record<string, PushResult> = {}) {
    const calls: { target: PushTarget; payload: Record<string, unknown> }[] = [];
    return {
      calls,
      sender: {
        enabled: () => true,
        send: ({ target, payload }: { target: PushTarget; payload: string }) => {
          calls.push({ target, payload: JSON.parse(payload) as Record<string, unknown> });
          return Promise.resolve(results[target.endpoint] ?? ('sent' as const));
        },
      },
    };
  }
  const pushWith = (sender: ReturnType<typeof fakeSender>['sender']) =>
    new RsvpPush(worker.get(PUSH_STORE), sender, worker.get(AppConfigService));

  async function scenario({ push = true, groups = 1 }: { push?: boolean; groups?: number } = {}) {
    const { id: userId } = await db.user.create({
      data: { email: `ana.${randomUUID()}@kore.local` },
    });
    const { weddingId } = await seedWedding({ db, ownerId: userId });
    await db.notificationPreference.create({ data: { userId, weddingId, type: 'rsvp', push } });
    const session = (revokedAt: Date | null = null) =>
      db.session.create({
        data: {
          userId,
          tokenHash: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 86_400_000),
          lastSeenAt: new Date(),
          authenticatedAt: new Date(),
          authMethod: 'email',
          revokedAt,
        },
      });
    const subscription = async (revoked = false) =>
      db.pushSubscription.create({
        data: {
          userId,
          sessionId: (await session(revoked ? new Date() : null)).id,
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`,
          p256dh: 'p',
          auth: 'a',
        },
      });
    const payload = Array.from({ length: groups }, (_, index) => ({
      partyId: randomUUID(),
      name: index === 0 ? 'Família Moreira' : `Grupo ${index}`,
      confirmed: 2,
      declined: 1,
      at: new Date().toISOString(),
    }));
    await db.notification.create({
      data: {
        userId,
        weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${weddingId}`,
        count: groups,
        payload,
      },
    });
    return { userId, weddingId, subscription };
  }

  it('RN07 - o aviso só com o nome do grupo, com a tag do casamento, em cada aparelho; grava o sucesso', async () => {
    const { userId, weddingId, subscription } = await scenario();
    const [phone, laptop] = [await subscription(), await subscription()];
    const { sender, calls } = fakeSender();

    expect(await pushWith(sender).send({ userId, weddingId, now: new Date() })).toEqual({
      sent: 2,
    });

    expect(calls.map((call) => call.target.endpoint).sort()).toEqual(
      [phone.endpoint, laptop.endpoint].sort(),
    );
    expect(calls[0].payload).toEqual({
      title: 'Kore',
      body: 'Família Moreira respondeu o convite',
      tag: `rsvp:${weddingId}`,
      url: 'http://localhost:5173/app/notificacoes',
    });
    expect(JSON.stringify(calls)).not.toMatch(/confirm|recus|\b2\b/);
    expect(
      (await db.pushSubscription.findUniqueOrThrow({ where: { id: phone.id } })).lastSuccessAt,
    ).not.toBeNull();
  });

  it('RN07 - agrupada: "{n} grupos responderam"', async () => {
    const { userId, weddingId, subscription } = await scenario({ groups: 3 });
    await subscription();
    const { sender, calls } = fakeSender();

    await pushWith(sender).send({ userId, weddingId, now: new Date() });

    expect(calls[0].payload.body).toBe('3 grupos responderam');
  });

  it('RN07, RN08 e RN09 - sem push ligado, sem vínculo ou de sessão revogada não sai; a revogada é apagada', async () => {
    const off = await scenario({ push: false });
    await off.subscription();
    const { sender, calls } = fakeSender();
    await pushWith(sender).send({ userId: off.userId, weddingId: off.weddingId, now: new Date() });

    const removed = await scenario();
    await removed.subscription();
    await db.membership.updateMany({
      where: { weddingId: removed.weddingId },
      data: { removedAt: new Date() },
    });
    await pushWith(sender).send({
      userId: removed.userId,
      weddingId: removed.weddingId,
      now: new Date(),
    });

    const revoked = await scenario();
    const stale = await revoked.subscription(true);
    await pushWith(sender).send({
      userId: revoked.userId,
      weddingId: revoked.weddingId,
      now: new Date(),
    });

    expect(calls).toEqual([]);
    expect(await db.pushSubscription.findUnique({ where: { id: stale.id } })).toBeNull();
  });

  it('RN07 (R8-7) - 404/410 apaga a assinatura; 429/5xx pede nova tentativa', async () => {
    const { userId, weddingId, subscription } = await scenario();
    const [gone, busy] = [await subscription(), await subscription()];
    const { sender } = fakeSender({ [gone.endpoint]: 'gone', [busy.endpoint]: 'retry' });

    await expect(
      pushWith(sender).send({ userId, weddingId, now: new Date() }),
    ).rejects.toBeInstanceOf(PushRetryError);

    expect(await db.pushSubscription.findUnique({ where: { id: gone.id } })).toBeNull();
    expect(await db.pushSubscription.findUnique({ where: { id: busy.id } })).not.toBeNull();
  });
});
