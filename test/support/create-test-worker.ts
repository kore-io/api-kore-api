import { Test, TestingModule } from '@nestjs/testing';
import { WorkerModule } from '../../src/worker.module';

/** Sobe o worker (filas e rotinas), como o processo separado de produção. */
export async function createTestWorker(): Promise<TestingModule> {
  const worker = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
  await worker.init();
  return worker;
}
