import { producerQueue } from '../../shared/jobs/producer-queue';
import { Module } from '@nestjs/common';
import { NOTIFICATION_DISPATCHER } from './application/ports/notification-dispatcher.port';
import { BullmqNotificationDispatcher } from './infrastructure/bullmq-notification-dispatcher';
import { NOTIFICATIONS_QUEUE } from './infrastructure/notifications-queue';
import { AccessModule } from '../access/access.module';
import { NotificationCenter, NotificationPreferences } from './application/notifications.use-cases';
import { NOTIFICATION_STORE } from './application/ports/notification-store.port';
import { PrismaNotificationStore } from './infrastructure/prisma-notification.store';
import { NotificationsController } from './presentation/notifications.controller';
import { PushSubscriptions } from './application/push-subscriptions.use-cases';
import { PUSH_SUBSCRIPTION_STORE } from './application/ports/push-subscription-store.port';
import { PrismaPushSubscriptionStore } from './infrastructure/prisma-push-subscription.store';
import { PushSubscriptionsController } from './presentation/push-subscriptions.controller';

/** Contexto Notificações (F5): a central e as preferências de cada pessoa. */
@Module({
  // A fila produtora sem fila offline (Central RN02): com o Redis fora, o
  // aviso depois do commit falha na hora e a resposta sai; a rotina de 15
  // minutos manda o que ficou.
  imports: [AccessModule, producerQueue(NOTIFICATIONS_QUEUE)],
  controllers: [NotificationsController, PushSubscriptionsController],
  providers: [
    { provide: NOTIFICATION_STORE, useClass: PrismaNotificationStore },
    NotificationCenter,
    NotificationPreferences,
    { provide: NOTIFICATION_DISPATCHER, useClass: BullmqNotificationDispatcher },
    { provide: PUSH_SUBSCRIPTION_STORE, useClass: PrismaPushSubscriptionStore },
    PushSubscriptions,
  ],
  // O RSVP avisa, depois do commit, que a notificação nasceu ou somou.
  exports: [NOTIFICATION_DISPATCHER],
})
export class NotificationsModule {}
