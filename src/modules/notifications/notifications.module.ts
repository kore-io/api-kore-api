import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATION_DISPATCHER } from './application/ports/notification-dispatcher.port';
import { BullmqNotificationDispatcher } from './infrastructure/bullmq-notification-dispatcher';
import { NOTIFICATIONS_QUEUE } from './infrastructure/notifications-queue';
import { AccessModule } from '../access/access.module';
import { NotificationCenter, NotificationPreferences } from './application/notifications.use-cases';
import { NOTIFICATION_STORE } from './application/ports/notification-store.port';
import { PrismaNotificationStore } from './infrastructure/prisma-notification.store';
import { NotificationsController } from './presentation/notifications.controller';

/** Contexto Notificações (F5): a central e as preferências de cada pessoa. */
@Module({
  imports: [AccessModule, BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_STORE, useClass: PrismaNotificationStore },
    NotificationCenter,
    NotificationPreferences,
    { provide: NOTIFICATION_DISPATCHER, useClass: BullmqNotificationDispatcher },
  ],
  // O RSVP avisa, depois do commit, que a notificação nasceu ou somou.
  exports: [NOTIFICATION_DISPATCHER],
})
export class NotificationsModule {}
