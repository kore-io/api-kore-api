import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { EmailOutbox, EmailPriority } from '../application/email-outbox.port';
import {
  EMAIL_SENDER,
  type EmailMessage,
  type EmailSender,
} from '../application/email-sender.port';
import {
  DEFAULT_EMAIL_QUEUE,
  DELIVER_EMAIL_JOB,
  EMAIL_JOB_OPTIONS,
  LOGIN_EMAIL_QUEUE,
} from './email-queues';

const ENQUEUE_WAIT_MS = 2_000;

/**
 * Entrega o e-mail para a fila do BullMQ. Se o Redis não responder, envia
 * direto pelo SMTP e avisa no log: o login não para por causa do Redis
 * (mesmo espírito da decisão 97, item 3).
 */
@Injectable()
export class BullmqEmailOutbox implements EmailOutbox {
  private readonly logger = new Logger('EmailOutbox');
  private readonly queues: Record<EmailPriority, Queue>;

  constructor(
    @InjectQueue(LOGIN_EMAIL_QUEUE) loginQueue: Queue,
    @InjectQueue(DEFAULT_EMAIL_QUEUE) defaultQueue: Queue,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
  ) {
    this.queues = { login: loginQueue, default: defaultQueue };
  }

  async enqueue({
    message,
    priority,
  }: {
    message: EmailMessage;
    priority: EmailPriority;
  }): Promise<void> {
    const queued = await this.addWithTimeout({ queue: this.queues[priority], message });
    if (queued) return;
    this.logger.warn(`Fila de e-mail indisponível (${priority}); envio direto.`);
    await this.sender.send({ message });
  }

  private async addWithTimeout({
    queue,
    message,
  }: {
    queue: Queue;
    message: EmailMessage;
  }): Promise<boolean> {
    const added = queue.add(DELIVER_EMAIL_JOB, { message }, EMAIL_JOB_OPTIONS).then(
      () => true,
      () => false,
    );
    const waited = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), ENQUEUE_WAIT_MS).unref();
    });
    return Promise.race([added, waited]);
  }
}
