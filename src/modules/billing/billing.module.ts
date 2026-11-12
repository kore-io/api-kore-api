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
import { BillingQuoteController, PricingController } from './presentation/pricing.controller';
import { AccessModule } from '../access/access.module';
import { QUOTE_TARGET_READER } from './application/ports/quote-target.reader.port';
import { QuoteBilling } from './application/quote-billing.use-case';
import { PrismaQuoteTargetReader } from './infrastructure/prisma-quote-target.reader';
import { PrismaPublicPricingReader } from './infrastructure/prisma-public-pricing.reader';

/** Cobrança e publicação (F3), do lado da API: a porta do gateway, o webhook, o preço e a cotação. */
@Module({
  imports: [AccessModule, BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE })],
  controllers: [PaymentWebhooksController, PricingController, BillingQuoteController],
  providers: [
    ...PAYMENT_GATEWAY_PROVIDERS,
    { provide: GATEWAY_EVENT_STORE, useClass: PrismaGatewayEventStore },
    { provide: GATEWAY_EVENT_QUEUE, useClass: BullmqGatewayEventQueue },
    ReceiveGatewayWebhook,
    ProcessGatewayEvent,
    PaymentWebhookRateLimitGuard,
    { provide: QUOTE_TARGET_READER, useClass: PrismaQuoteTargetReader },
    QuoteBilling,
    PrismaPublicPricingReader,
  ],
  exports: [PAYMENT_GATEWAY, LocalGatewayStore, ReceiveGatewayWebhook, ProcessGatewayEvent],
})
export class BillingModule {}
