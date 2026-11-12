import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LogsWorkerModule } from '../logs/logs-worker.module';
import { NOTIFICATION_EMAIL_STORE } from './application/ports/notification-email-store.port';
import { RsvpEmails } from './application/rsvp-emails.use-cases';
import { RsvpPush } from './application/rsvp-push.use-case';
import { PUSH_SENDER } from './application/ports/push-sender.port';
import { PUSH_STORE } from './application/ports/push-store.port';
import { PrismaPushStore } from './infrastructure/backoffice/prisma-push.store';
import { WebPushSender } from './infrastructure/web-push-sender';
import { PrismaNotificationEmailStore } from './infrastructure/backoffice/prisma-notification-email.store';
import { NOTIFICATIONS_QUEUE } from './infrastructure/notifications-queue';
import {
  NotificationsProcessor,
  NotificationsSweepScheduler,
} from './infrastructure/notifications.processor';
import { CleanNotifications } from './application/clean-notifications.use-case';
import { NOTIFICATION_RETENTION } from './application/ports/notification-retention.port';
import { PrismaNotificationRetention } from './infrastructure/backoffice/prisma-notification-retention';
import {
  NOTIFICATION_RETENTION_QUEUE,
  NotificationRetentionProcessor,
  NotificationRetentionScheduler,
} from './infrastructure/notification-retention.job';
import { PlannerDigest } from './application/planner-digest.use-case';
import { PLANNER_DIGEST_STORE } from './application/ports/planner-digest-store.port';
import { PrismaPlannerDigestStore } from './infrastructure/backoffice/prisma-planner-digest.store';

/** Rotinas das notificações, do lado do worker: a retenção da central e os e-mails. */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_RETENTION_QUEUE }, { name: NOTIFICATIONS_QUEUE }),
    // O log da aplicação pela conexão do backoffice (notification.email_failed).
    LogsWorkerModule,
  ],
  providers: [
    { provide: NOTIFICATION_EMAIL_STORE, useClass: PrismaNotificationEmailStore },
    RsvpEmails,
    { provide: PUSH_STORE, useClass: PrismaPushStore },
    { provide: PUSH_SENDER, useClass: WebPushSender },
    RsvpPush,
    { provide: PLANNER_DIGEST_STORE, useClass: PrismaPlannerDigestStore },
    PlannerDigest,
    NotificationsProcessor,
    NotificationsSweepScheduler,
    { provide: NOTIFICATION_RETENTION, useClass: PrismaNotificationRetention },
    CleanNotifications,
    NotificationRetentionProcessor,
    NotificationRetentionScheduler,
  ],
})
export class NotificationsWorkerModule {}
