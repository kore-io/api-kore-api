import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  APPLICATION_LOG_RETENTION_QUEUE,
  APPLICATION_LOG_RETENTION_SCHEDULER_ID,
  ApplicationLogRetentionProcessor,
} from '../../src/modules/logs/infrastructure/application-log-retention.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { WorkerModule } from '../../src/worker.module';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

describe('Rotina de retenção do log da aplicação no worker (decisão 137)', () => {
  let worker: TestingModule;
  let backoffice: BackofficePrismaService;

  beforeAll(async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await worker.init();
    backoffice = worker.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
  });

  it('dado o worker no ar, quando sobe, então a rotina diária fica agendada com id fixo', async () => {
    const queue = worker.get<Queue>(getQueueToken(APPLICATION_LOG_RETENTION_QUEUE));

    const scheduler = await queue.getJobScheduler(APPLICATION_LOG_RETENTION_SCHEDULER_ID);

    expect(scheduler).toMatchObject({ pattern: '30 4 * * *', tz: 'America/Sao_Paulo' });
  });

  it('dado log com mais e com menos de 5 anos, quando a rotina roda, então apaga só o vencido e registra a execução', async () => {
    const entityType = `teste-${randomUUID()}`;
    const now = Date.now();
    await backoffice.applicationLog.createMany({
      data: [
        {
          action: 'teste.antigo',
          actorKind: 'system',
          entityType,
          createdAt: new Date(now - 5.1 * YEAR_MS),
        },
        {
          action: 'teste.recente',
          actorKind: 'system',
          entityType,
          createdAt: new Date(now - 4.9 * YEAR_MS),
        },
      ],
    });
    const startedAt = new Date();

    const { deleted } = await worker.get(ApplicationLogRetentionProcessor).process();

    const remaining = await backoffice.applicationLog.findMany({ where: { entityType } });
    expect(remaining.map((row) => row.action)).toEqual(['teste.recente']);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const [purge] = await backoffice.applicationLog.findMany({
      where: { action: 'application_log.purged', createdAt: { gte: startedAt } },
    });
    expect(purge).toMatchObject({
      actorKind: 'system',
      data: { deleted, cutoff: expect.any(String) },
    });
  });
});
