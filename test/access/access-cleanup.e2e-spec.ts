import { getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  ACCESS_CLEANUP_QUEUE,
  ACCESS_CLEANUP_SCHEDULER_ID,
  AccessCleanupProcessor,
} from '../../src/modules/access/infrastructure/access-cleanup.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestWorker } from '../support/create-test-worker';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Limpeza diária de sessões e pedidos de login (worker)', () => {
  let worker: TestingModule;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    worker = await createTestWorker();
    db = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  it('dado o worker no ar, quando sobe, então a rotina diária fica agendada com id fixo', async () => {
    const queue = worker.get<Queue>(getQueueToken(ACCESS_CLEANUP_QUEUE));

    expect(await queue.getJobScheduler(ACCESS_CLEANUP_SCHEDULER_ID)).toMatchObject({
      pattern: '30 5 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('dadas sessões vigentes, vencidas e encerradas, quando a rotina roda, então apaga só as que não valem', async () => {
    const now = Date.now();
    const { id: userId } = await db.user.create({
      data: { email: `limpeza.${randomUUID()}@kore.local` },
    });
    const session = (overrides: { expiresAt: Date; revokedAt?: Date }) => ({
      userId,
      tokenHash: randomUUID(),
      lastSeenAt: new Date(now),
      authenticatedAt: new Date(now),
      authMethod: 'email' as const,
      ...overrides,
    });
    await db.session.createMany({
      data: [
        session({ expiresAt: new Date(now + DAY_MS) }), // vigente
        session({ expiresAt: new Date(now - 1000) }), // vencida
        session({ expiresAt: new Date(now + DAY_MS), revokedAt: new Date(now) }), // encerrada
      ],
    });

    await worker.get(AccessCleanupProcessor).process();

    expect(await db.session.count({ where: { userId } })).toBe(1);
  });

  it('RN04 - dados pedidos de login da última hora (vigente, vencido, usado e invalidado) e mais antigos, quando a rotina roda, então só os de mais de 1 hora saem, e a execução é registrada', async () => {
    const now = Date.now();
    const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000);
    const email = `pedido.${randomUUID()}@kore.local`;
    const challenge = (overrides: {
      createdAt: Date;
      expiresAt: Date;
      consumedAt?: Date;
      invalidatedAt?: Date;
    }) => ({ email, tokenHash: randomUUID(), codeHash: 'x', ...overrides });
    await db.loginChallenge.createMany({
      data: [
        // Da última hora: ainda contam no limite de 5 por hora e ficam.
        challenge({ createdAt: minutesAgo(1), expiresAt: minutesAgo(-14) }),
        challenge({ createdAt: minutesAgo(20), expiresAt: minutesAgo(5) }),
        challenge({
          createdAt: minutesAgo(10),
          expiresAt: minutesAgo(-5),
          consumedAt: minutesAgo(9),
        }),
        challenge({
          createdAt: minutesAgo(30),
          expiresAt: minutesAgo(15),
          invalidatedAt: minutesAgo(25),
        }),
        // Fora da janela da RN04: saem.
        challenge({ createdAt: minutesAgo(61), expiresAt: minutesAgo(46) }),
        challenge({
          createdAt: minutesAgo(120),
          expiresAt: minutesAgo(105),
          consumedAt: minutesAgo(119),
        }),
      ],
    });
    const startedAt = new Date();

    const result = await worker.get(AccessCleanupProcessor).process();

    const remaining = await db.loginChallenge.findMany({
      where: { email },
      select: { createdAt: true },
    });
    expect(remaining).toHaveLength(4);
    expect(remaining.every(({ createdAt }) => createdAt > minutesAgo(60))).toBe(true);
    expect(result.loginChallenges).toBeGreaterThanOrEqual(2);
    const [entry] = await db.applicationLog.findMany({
      where: { action: 'access_cleanup.purged', createdAt: { gte: startedAt } },
    });
    expect(entry).toMatchObject({
      actorKind: 'system',
      data: { ...result, now: expect.any(String) },
    });
  });
});
