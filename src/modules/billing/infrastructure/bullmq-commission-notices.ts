import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  type CommissionEmailJob,
  type PushJob,
} from '../../notifications/infrastructure/notifications-queue';
import type { CommissionNotices } from '../application/ports/commission-notices.port';

const RETRIES = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: true,
  removeOnFail: 100,
};

/** Entra na fila das notificações, como o push da cobrança. */
@Injectable()
export class BullmqCommissionNotices implements CommissionNotices {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  async released({
    items,
  }: {
    items: readonly { userId: string; weddingId: string }[];
  }): Promise<void> {
    for (const { userId, weddingId } of items) {
      const job: PushJob = { userId, weddingId, type: 'commission' };
      await this.queue.add('push', job, RETRIES);
    }
    for (const userId of new Set(items.map((item) => item.userId))) {
      const job: CommissionEmailJob = { userId };
      await this.queue.add('commission-email', job, RETRIES);
    }
  }
}
