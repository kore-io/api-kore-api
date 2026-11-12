import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { NotificationDispatcher } from '../application/ports/notification-dispatcher.port';
import { NOTIFICATIONS_QUEUE, type NotifiedJob } from './notifications-queue';

/** Entra na fila das notificações; o worker decide o e-mail e o push. */
@Injectable()
export class BullmqNotificationDispatcher implements NotificationDispatcher {
  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  async notified({
    weddingId,
    userIds,
  }: {
    weddingId: string;
    userIds: readonly string[];
  }): Promise<void> {
    if (userIds.length === 0) return;
    const data: NotifiedJob = { weddingId, userIds: [...userIds] };
    await this.queue.add('notified', data, { removeOnComplete: true, removeOnFail: 100 });
  }
}
