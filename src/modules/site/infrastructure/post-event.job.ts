import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { MoveToPostEvent } from '../application/move-to-post-event.use-case';

export const POST_EVENT_QUEUE = 'post-event';
export const POST_EVENT_SCHEDULER_ID = 'move-to-post-event';
// Todo dia às 3h15, horário de Brasília: já passou da meia-noite em todos os
// fusos do Brasil (o Acre fica 2 horas atrás), e não cruza outra rotina.
const DAILY_AT_3_15AM = '15 3 * * *';

const logger = new Logger('PostEvent');

/** A passagem diária ao pós-evento (Publicação RN08). */
@Processor(POST_EVENT_QUEUE)
export class PostEventProcessor extends WorkerHost {
  constructor(private readonly move: MoveToPostEvent) {
    super();
  }

  async process(): Promise<{ moved: number }> {
    const result = await this.move.execute({ now: new Date() });
    logger.log(`Pós-evento: ${result.moved} casamentos.`);
    return result;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class PostEventScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(POST_EVENT_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: POST_EVENT_SCHEDULER_ID,
      cronPattern: DAILY_AT_3_15AM,
      logger,
    });
  }
}
