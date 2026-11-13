import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DelayedError, type Job, type Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { PlannerDigest } from '../application/planner-digest.use-case';
import { RsvpEmails } from '../application/rsvp-emails.use-cases';
import { RsvpPush } from '../application/rsvp-push.use-case';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATIONS_SWEEP_SCHEDULER_ID,
  type EmailJob,
  type NotifiedJob,
  type PushJob,
} from './notifications-queue';

const logger = new Logger('Notifications');
// A cada 15 minutos (E-mail e push RN04).
const EVERY_15_MINUTES = '*/15 * * * *';
/** O "Na hora" com novas tentativas e espera (RN06). */
const EMAIL_ATTEMPTS = 5;

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    private readonly emails: RsvpEmails,
    private readonly push: RsvpPush,
    private readonly plannerDigest: PlannerDigest,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job, token?: string): Promise<unknown> {
    const now = new Date();
    if (job.name === 'notified') return this.notified({ data: job.data as NotifiedJob, now });
    if (job.name === 'push') {
      const { userId, weddingId, type = 'rsvp' } = job.data as PushJob;
      return this.push.send({ userId, weddingId, type, now });
    }
    if (job.name === 'email') {
      const { userId, weddingId } = job.data as EmailJob;
      const result = await this.emails.send({ userId, weddingId, mode: 'immediate', now });
      // Dentro dos 15 minutos do último: o mesmo job espera e sai um só (RN03).
      if (result.kind === 'later') {
        await job.moveToDelayed(result.at.getTime(), token);
        throw new DelayedError();
      }
      return result;
    }
    // O job da rotina de 15 minutos (o nome é o do agendamento).
    const result = await this.emails.sweep({ now });
    if (result.sent || result.failed)
      logger.log(`E-mails de respostas: ${result.sent} enviados, ${result.failed} falhas.`);
    // O Resumo agrupado da cerimonialista (Notificações da cerimonialista RN07).
    const digests = await this.plannerDigest.sweep({ now });
    if (digests.sent || digests.failed)
      logger.log(`Resumos agrupados: ${digests.sent} enviados, ${digests.failed} falhas.`);
    return { ...result, plannerDigests: digests };
  }

  /**
   * Para cada destinatário em "Na hora", um job por pessoa e casamento: a
   * deduplicação do BullMQ junta as respostas que chegam no intervalo num só
   * (R8-4; um jobId fixo de um job já completo seria ignorado em silêncio).
   */
  private async notified({ data, now }: { data: NotifiedJob; now: Date }): Promise<number> {
    let scheduled = 0;
    for (const userId of data.userIds) {
      // O push sai a cada soma (RN07), com novas tentativas para 429 e 5xx.
      const target: EmailJob = { userId, weddingId: data.weddingId };
      await this.queue.add('push', target, {
        attempts: EMAIL_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      const at = await this.emails.immediateAt({ userId, weddingId: data.weddingId, now });
      if (!at) continue;
      const job: EmailJob = { userId, weddingId: data.weddingId };
      await this.queue.add('email', job, {
        delay: Math.max(0, at.getTime() - now.getTime()),
        deduplication: { id: `email:${userId}:${data.weddingId}` },
        attempts: EMAIL_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      scheduled++;
    }
    return scheduled;
  }

  // Desistiu do "Na hora" depois das tentativas: o log, só com ids (RN06).
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    logger.warn(`Job de notificação falhou (${job?.name ?? '?'}): ${error.name}`);
    if (!job || job.name !== 'email' || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.emails.recordFailure(job.data as EmailJob);
    } catch (logError) {
      logger.warn(`Log da falha do e-mail não gravado: ${(logError as Error).name}`);
    }
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) a rotina de 15 minutos na subida do worker. */
@Injectable()
export class NotificationsSweepScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: NOTIFICATIONS_SWEEP_SCHEDULER_ID,
      cronPattern: EVERY_15_MINUTES,
      logger,
    });
  }
}
