import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { EmailDeliveryFailures } from '../application/email-delivery-failures';
import type { EmailTag } from '../application/email-outbox.port';
import type { Job } from 'bullmq';
import {
  EMAIL_SENDER,
  type EmailMessage,
  type EmailSender,
} from '../application/email-sender.port';
import { DEFAULT_EMAIL_QUEUE, LOGIN_EMAIL_QUEUE } from './email-queues';

const logger = new Logger('EmailDelivery');

/** Envia pelo SMTP o e-mail que entrou na fila. */
abstract class EmailDeliveryProcessor extends WorkerHost {
  constructor(
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    private readonly failures: EmailDeliveryFailures,
  ) {
    super();
  }

  async process(job: Job<{ message: EmailMessage; tag?: EmailTag }>): Promise<void> {
    await this.sender.send({ message: job.data.message });
  }

  // Só o tipo do erro: a mensagem do SMTP pode trazer o e-mail do destinatário.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<{ tag?: EmailTag }> | undefined, error: Error): Promise<void> {
    logger.warn(
      `Envio de e-mail falhou (job ${job?.id ?? '?'}, tentativa ${job?.attemptsMade ?? 0}): ${error.name}`,
    );
    // Desistiu de vez: quem etiquetou o e-mail fica sabendo (decisão 180(8)).
    const tag = job?.data.tag;
    if (!job || !tag || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    try {
      await this.failures.gaveUp({ tag });
    } catch (handlerError) {
      logger.warn(`Aviso de desistência falhou (${tag.kind}): ${(handlerError as Error).name}`);
    }
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Fila prioritária do código de login (ADR do SES). */
@Processor(LOGIN_EMAIL_QUEUE, { concurrency: 10 })
export class LoginEmailProcessor extends EmailDeliveryProcessor {}

@Processor(DEFAULT_EMAIL_QUEUE, { concurrency: 5 })
export class DefaultEmailProcessor extends EmailDeliveryProcessor {}
