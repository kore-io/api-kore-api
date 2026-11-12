import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CleanNotifications } from './application/clean-notifications.use-case';
import { NOTIFICATION_RETENTION } from './application/ports/notification-retention.port';
import { PrismaNotificationRetention } from './infrastructure/backoffice/prisma-notification-retention';
import {
  NOTIFICATION_RETENTION_QUEUE,
  NotificationRetentionProcessor,
  NotificationRetentionScheduler,
} from './infrastructure/notification-retention.job';

/** Rotinas das notificações, do lado do worker: a retenção da central. */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_RETENTION_QUEUE })],
  providers: [
    { provide: NOTIFICATION_RETENTION, useClass: PrismaNotificationRetention },
    CleanNotifications,
    NotificationRetentionProcessor,
    NotificationRetentionScheduler,
  ],
})
export class NotificationsWorkerModule {}
