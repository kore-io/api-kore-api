import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PaymentWebhookRateLimitGuard } from '../../shared/rate-limit/payment-webhook-rate-limit.guard';
import { GATEWAY_EVENT_QUEUE } from './application/ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE } from './application/ports/gateway-event.store.port';
import { PAYMENT_GATEWAY } from './application/ports/payment-gateway.port';
import { ProcessGatewayEvent } from './application/process-gateway-event.use-case';
import { ReceiveGatewayWebhook } from './application/receive-gateway-webhook.use-case';
import { PrismaGatewayEventStore } from './infrastructure/backoffice/prisma-gateway-event.store';
import {
  BullmqGatewayEventQueue,
  GATEWAY_EVENTS_QUEUE,
} from './infrastructure/gateway-events.queue';
import { LocalGatewayStore } from './infrastructure/backoffice/local-gateway/local-gateway.store';
import { PAYMENT_GATEWAY_PROVIDERS } from './infrastructure/backoffice/payment-gateway.providers';
import { PaymentWebhooksController } from './presentation/payment-webhooks.controller';

/** Cobrança e publicação (F3), do lado da API: a porta do gateway e o webhook. */
@Module({
  imports: [BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE })],
  controllers: [PaymentWebhooksController],
  providers: [
    ...PAYMENT_GATEWAY_PROVIDERS,
    { provide: GATEWAY_EVENT_STORE, useClass: PrismaGatewayEventStore },
    { provide: GATEWAY_EVENT_QUEUE, useClass: BullmqGatewayEventQueue },
    ReceiveGatewayWebhook,
    ProcessGatewayEvent,
    PaymentWebhookRateLimitGuard,
  ],
  exports: [PAYMENT_GATEWAY, LocalGatewayStore, ReceiveGatewayWebhook, ProcessGatewayEvent],
})
export class BillingModule {}
