import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NOTIFICATIONS_QUEUE } from '../notifications/infrastructure/notifications-queue';
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
import { PAYMENT_PROCESSING_PROVIDERS } from './infrastructure/payment-processing.providers';
import { CreatePayment } from './application/create-payment.use-case';
import { GetBilling } from './application/get-billing.use-case';
import {
  GATEWAY_CUSTOMERS,
  PAYMENT_REQUEST_STORE,
} from './application/ports/payment-request.store.port';
import { BILLING_VIEW_READER } from './application/ports/billing-view.reader.port';
import { PrismaPaymentRequestStore } from './infrastructure/prisma-payment-request.store';
import { PrismaGatewayCustomers } from './infrastructure/backoffice/prisma-gateway-customers';
import { PrismaBillingViewReader } from './infrastructure/prisma-billing-view.reader';
import { PaymentsController } from './presentation/payments.controller';

/**
 * Cobrança e publicação (F3), do lado da API: a porta do gateway, o webhook, o
 * preço, a cotação, o pagamento e a leitura da cobrança.
 */
@Module({
  imports: [
    AccessModule,
    BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [
    PaymentWebhooksController,
    PricingController,
    BillingQuoteController,
    PaymentsController,
  ],
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
    ...PAYMENT_PROCESSING_PROVIDERS,
    { provide: PAYMENT_REQUEST_STORE, useClass: PrismaPaymentRequestStore },
    { provide: GATEWAY_CUSTOMERS, useClass: PrismaGatewayCustomers },
    { provide: BILLING_VIEW_READER, useClass: PrismaBillingViewReader },
    CreatePayment,
    GetBilling,
  ],
  exports: [PAYMENT_GATEWAY, LocalGatewayStore, ReceiveGatewayWebhook, ProcessGatewayEvent],
})
export class BillingModule {}
