import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CleanNotifications } from '../../src/modules/notifications/application/clean-notifications.use-case';
import {
  NOTIFICATION_RETENTION_QUEUE,
  NOTIFICATION_RETENTION_SCHEDULER_ID,
} from '../../src/modules/notifications/infrastructure/notification-retention.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';

const DAY_MS = 86_400_000;

/** A retenção da central (Central RN08; worker). */
describe('Retenção das notificações (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  it('RN08 - a rotina fica agendada todo dia de madrugada', async () => {
    const queue = worker.get<Queue>(getQueueToken(NOTIFICATION_RETENTION_QUEUE));

    expect(await queue.getJobScheduler(NOTIFICATION_RETENTION_SCHEDULER_ID)).toMatchObject({
      pattern: '45 4 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('RN08 - apaga as lidas há mais de 90 dias; as mais novas e as não lidas ficam', async () => {
    const { id: userId } = await db.user.create({
      data: { email: `retencao.${randomUUID()}@kore.local` },
    });
    const { weddingId } = await seedWedding({ db, ownerId: userId });
    const now = new Date('2027-01-31T12:00:00Z');
    const create = (key: string, readAt: Date | null) =>
      db.notification.create({
        data: { userId, weddingId, type: 'rsvp', groupKey: key, payload: [], readAt },
      });
    const old = await create('a', new Date(now.getTime() - 91 * DAY_MS));
    const recent = await create('b', new Date(now.getTime() - 89 * DAY_MS));
    const unread = await create('c', null);

    await worker.get(CleanNotifications).execute({ now });

    const left = await db.notification.findMany({ where: { weddingId }, select: { id: true } });
    expect(left.map((row) => row.id).sort()).toEqual([recent.id, unread.id].sort());
    expect(left.map((row) => row.id)).not.toContain(old.id);
  });
});
