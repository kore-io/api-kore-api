import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { ActivatePixKeys } from '../application/activate-pix-keys.use-case';

export const PIX_KEY_ACTIVATION_QUEUE = 'pix-key-activation';
export const PIX_KEY_ACTIVATION_SCHEDULER_ID = 'activate-pix-keys';
// A cada 15 minutos: a troca vale "às 14h de 28/09" (Repasse RN03).
const EVERY_15_MINUTES = '*/15 * * * *';

const logger = new Logger('PixKeyActivation');

@Processor(PIX_KEY_ACTIVATION_QUEUE)
export class PixKeyActivationProcessor extends WorkerHost {
  constructor(private readonly activate: ActivatePixKeys) {
    super();
  }

  async process(): Promise<{ activated: number }> {
    const result = await this.activate.execute({ now: new Date() });
    if (result.activated > 0) logger.log(`Chaves Pix ativadas: ${result.activated}.`);
    return result;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

@Injectable()
export class PixKeyActivationScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PIX_KEY_ACTIVATION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: PIX_KEY_ACTIVATION_SCHEDULER_ID,
      cronPattern: EVERY_15_MINUTES,
      logger,
    });
  }
}
