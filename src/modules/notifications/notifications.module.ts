import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { NotificationCenter, NotificationPreferences } from './application/notifications.use-cases';
import { NOTIFICATION_STORE } from './application/ports/notification-store.port';
import { PrismaNotificationStore } from './infrastructure/prisma-notification.store';
import { NotificationsController } from './presentation/notifications.controller';

/** Contexto Notificações (F5): a central e as preferências de cada pessoa. */
@Module({
  imports: [AccessModule],
  controllers: [NotificationsController],
  providers: [
    { provide: NOTIFICATION_STORE, useClass: PrismaNotificationStore },
    NotificationCenter,
    NotificationPreferences,
  ],
})
export class NotificationsModule {}
