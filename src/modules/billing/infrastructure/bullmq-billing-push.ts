import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  type PushJob,
} from '../../notifications/infrastructure/notifications-queue';
import type { BillingPush } from '../application/ports/billing-push.port';

/** Entra na fila das notificações, como o push da resposta (E-mail e push RN07). */
@Injectable()
export class BullmqBillingPush implements BillingPush {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  async paymentConfirmed({
    weddingId,
    userIds,
  }: {
    weddingId: string;
    userIds: readonly string[];
  }): Promise<void> {
    for (const userId of userIds) {
      const job: PushJob = { userId, weddingId, type: 'billing' };
      // Novas tentativas para 429 e 5xx do serviço de push, como o da resposta.
      await this.queue.add('push', job, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
    }
  }
}
