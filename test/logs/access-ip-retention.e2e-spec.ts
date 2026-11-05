import { getQueueToken } from '@nestjs/bullmq';
import { TestingModule, Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import {
  ACCESS_IP_RETENTION_QUEUE,
  ACCESS_IP_RETENTION_SCHEDULER_ID,
  AccessIpRetentionProcessor,
} from '../../src/modules/logs/infrastructure/access-ip-retention.job';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { WorkerModule } from '../../src/worker.module';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Rotina de retenção do IP real no worker (decisão 116)', () => {
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
    const queue = worker.get<Queue>(getQueueToken(ACCESS_IP_RETENTION_QUEUE));

    const scheduler = await queue.getJobScheduler(ACCESS_IP_RETENTION_SCHEDULER_ID);

    expect(scheduler).toMatchObject({ pattern: '0 4 * * *', tz: 'America/Sao_Paulo' });
  });

  it('dado IP real com mais e com menos de 6 meses, quando a rotina roda, então apaga só o vencido', async () => {
    const actorUserId = randomUUID();
    const now = Date.now();
    await backoffice.accessIpLog.createMany({
      data: [
        {
          action: 'login',
          ip: '10.0.0.1',
          actorKind: 'user',
          actorUserId,
          occurredAt: new Date(now - 200 * DAY_MS),
        },
        {
          action: 'login',
          ip: '10.0.0.2',
          actorKind: 'user',
          actorUserId,
          occurredAt: new Date(now - 150 * DAY_MS),
        },
      ],
    });

    await worker.get(AccessIpRetentionProcessor).process();

    const remaining = await backoffice.accessIpLog.findMany({ where: { actorUserId } });
    expect(remaining.map((row) => row.ip)).toEqual(['10.0.0.2']);
  });

  it('dada a rotina com BYPASSRLS, quando roda, então registra a execução no log da aplicação (decisão 137)', async () => {
    const startedAt = new Date();

    const { deleted } = await worker.get(AccessIpRetentionProcessor).process();

    const [entry] = await backoffice.applicationLog.findMany({
      where: { action: 'access_ip_log.purged', createdAt: { gte: startedAt } },
    });
    expect(entry).toMatchObject({
      actorKind: 'system',
      actorUserId: null,
      data: { deleted, cutoff: expect.any(String) },
    });
  });
});
