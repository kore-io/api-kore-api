import { WorkerHost } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { WorkerModule } from '@/app/worker.module';

/**
 * As rotinas agendadas ficam registradas (os testes conferem o cron e o fuso),
 * mas só disparam a partir daqui: nenhuma rodada real, com a hora de verdade,
 * cai no meio de um teste.
 */
const SCHEDULERS_START = new Date('2100-01-01T00:00:00Z');

/**
 * Sobe o worker (filas e rotinas), como o processo separado de produção.
 *
 * As rotinas (a varredura de 15 minutos, as diárias) não rodam sozinhas no
 * e2e: com o cron real, a de qualquer arquivo varria o kore_test compartilhado
 * com a hora de verdade e, à noite, mandava o Resumo diário de um casamento de
 * outro teste. Os testes chamam o caso de uso com o `now` deles.
 *
 * No fim do arquivo, os workers do BullMQ fecham sem esperar os jobs em voo
 * (`close(true)`): o `close()` normal espera cada job ativo terminar, e um job
 * com espera (o estorno, um evento do gateway) estourava os 20 s do `afterAll`
 * de vez em quando. O teste não depende do job em voo; as chaves do prefixo
 * do arquivo são apagadas depois (test/e2e/setup/queue-cleanup.ts).
 */
export async function createTestWorker(): Promise<TestingModule> {
  const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await worker.init();
  await holdSchedulers(worker);
  const close = worker.close.bind(worker);
  worker.close = async () => {
    const hosts = worker
      .get(DiscoveryService)
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter((instance): instance is WorkerHost => instance instanceof WorkerHost);
    await Promise.all(hosts.map((host) => host.worker.close(true)));
    await close();
  };
  return worker;
}

/** Regrava cada rotina com o mesmo cron e fuso, começando em 2100. */
async function holdSchedulers(worker: TestingModule): Promise<void> {
  const queues = new Set(
    worker
      .get(DiscoveryService)
      .getProviders()
      .map((wrapper) => wrapper.instance as unknown)
      .filter((instance): instance is Queue => instance instanceof Queue),
  );
  for (const queue of queues) {
    for (const scheduler of await queue.getJobSchedulers()) {
      if (!scheduler.pattern) continue;
      await queue.removeJobScheduler(scheduler.key);
      await queue.upsertJobScheduler(scheduler.key, {
        pattern: scheduler.pattern,
        ...(scheduler.tz ? { tz: scheduler.tz } : {}),
        startDate: SCHEDULERS_START,
      });
    }
  }
}
