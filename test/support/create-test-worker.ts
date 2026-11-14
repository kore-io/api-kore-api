import { WorkerHost } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkerModule } from '../../src/worker.module';

/**
 * Sobe o worker (filas e rotinas), como o processo separado de produção.
 *
 * No fim do arquivo, os workers do BullMQ fecham sem esperar os jobs em voo
 * (`close(true)`): o `close()` normal espera cada job ativo terminar, e um job
 * com espera (o estorno, um evento do gateway) estourava os 20 s do `afterAll`
 * de vez em quando. O teste não depende do job em voo; as chaves do prefixo
 * do arquivo são apagadas depois (test/setup/queue-cleanup.ts).
 */
export async function createTestWorker(): Promise<TestingModule> {
  const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await worker.init();
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
