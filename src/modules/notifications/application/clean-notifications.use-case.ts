import { Inject, Injectable } from '@nestjs/common';
import {
  NOTIFICATION_RETENTION,
  type NotificationRetention,
} from './ports/notification-retention.port';

/** As lidas há mais de 90 dias saem (Central RN08; decisão 217(14)). */
export const READ_RETENTION_DAYS = 90;

@Injectable()
export class CleanNotifications {
  constructor(@Inject(NOTIFICATION_RETENTION) private readonly retention: NotificationRetention) {}

  async execute({ now }: { now: Date }): Promise<{ deleted: number }> {
    const readBefore = new Date(now.getTime() - READ_RETENTION_DAYS * 86_400_000);
    return { deleted: await this.retention.deleteRead({ readBefore }) };
  }
}
