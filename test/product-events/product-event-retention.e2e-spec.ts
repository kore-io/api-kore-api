import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  PRODUCT_EVENT_RETENTION_QUEUE,
  PRODUCT_EVENT_RETENTION_SCHEDULER_ID,
  ProductEventRetentionProcessor,
} from '../../src/modules/product-events/infrastructure/product-event-retention.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { WorkerModule } from '../../src/worker.module';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

describe('Retenção de 18 meses dos eventos de produto no worker', () => {
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
    const queue = worker.get<Queue>(getQueueToken(PRODUCT_EVENT_RETENTION_QUEUE));

    expect(await queue.getJobScheduler(PRODUCT_EVENT_RETENTION_SCHEDULER_ID)).toMatchObject({
      pattern: '0 5 * * *',
      tz: 'America/Sao_Paulo',
    });
  });

  it('dados eventos com mais e com menos de 18 meses, quando a rotina roda, então apaga só o vencido e registra a execução', async () => {
    const weddingRef = `ref-${randomUUID()}`;
    const now = Date.now();
    await backoffice.productEvent.createMany({
      data: [
        { name: 'casal_aceitou', weddingRef, occurredAt: new Date(now - 19 * MONTH_MS) },
        { name: 'casal_aceitou', weddingRef, occurredAt: new Date(now - 17 * MONTH_MS) },
      ],
    });
    const startedAt = new Date();

    const { deleted } = await worker.get(ProductEventRetentionProcessor).process();

    expect(await backoffice.productEvent.count({ where: { weddingRef } })).toBe(1);
    const [purge] = await backoffice.applicationLog.findMany({
      where: { action: 'product_event.purged', createdAt: { gte: startedAt } },
    });
    expect(purge).toMatchObject({
      actorKind: 'system',
      data: { deleted, cutoff: expect.any(String) },
    });
  });
});
