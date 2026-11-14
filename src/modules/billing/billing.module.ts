import { AdminPaymentActions } from './application/admin-payment-actions.use-cases';
import { ExtendAsCourtesy } from './application/courtesy-extension.use-case';
import { AdminRefund } from './application/admin-refund.use-case';
import { PAYOUT_ADMIN_STORE } from './application/ports/payout-admin.store.port';
import {
  ListPayoutQueue,
  RejectPayout,
  ReleasePayout,
} from './application/payouts/payout-admin.use-cases';
import { PayPayout, RetryPayout } from './application/payouts/payout-transfers.use-cases';
import { PrismaPayoutAdminStore } from './infrastructure/backoffice/prisma-payout-admin.store';
import { PAYOUT_TRANSFERS_QUEUE } from './infrastructure/payout-transfers.queue';
import { producerQueue } from '../../shared/jobs/producer-queue';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BlockWedding } from './application/block-wedding.use-case';
import { WEDDING_BLOCKS } from './application/ports/wedding-blocks.port';
import { PrismaWeddingBlocks } from './infrastructure/backoffice/prisma-wedding-blocks';
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
import { REFUND_REQUEST_STORE } from './application/ports/refund-request.store.port';
import { RequestRefund } from './application/request-refund.use-case';
import { WEDDING_DELETION_STORE } from './application/ports/wedding-deletion.store.port';
import {
  CancelWeddingDeletion,
  RequestWeddingDeletion,
} from './application/wedding-deletion.use-cases';
import { PrismaWeddingDeletionStore } from './infrastructure/backoffice/prisma-wedding-deletion.store';
import { WeddingDeletionController } from './presentation/wedding-deletion.controller';
import { ChangeEndDate } from './application/change-end-date.use-case';
import { PrismaRefundRequestStore } from './infrastructure/prisma-refund-request.store';
import { PAYMENT_REFUNDS_QUEUE } from './infrastructure/refunds.queue';

/**
 * Cobrança e publicação (F3), do lado da API: a porta do gateway, o webhook, o
 * preço, a cotação, o pagamento e a leitura da cobrança.
 */
@Module({
  imports: [
    AccessModule,
    BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE }),
    // O push da cobrança: a mesma fila produtora, sem fila offline (Central RN02).
    producerQueue(NOTIFICATIONS_QUEUE),
    BullModule.registerQueue({ name: PAYMENT_REFUNDS_QUEUE }),
    BullModule.registerQueue({ name: PAYOUT_TRANSFERS_QUEUE }),
  ],
  controllers: [
    PaymentWebhooksController,
    PricingController,
    BillingQuoteController,
    PaymentsController,
    WeddingDeletionController,
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
    { provide: REFUND_REQUEST_STORE, useClass: PrismaRefundRequestStore },
    RequestRefund,
    ChangeEndDate,
    { provide: WEDDING_BLOCKS, useClass: PrismaWeddingBlocks },
    BlockWedding,
    { provide: PAYOUT_ADMIN_STORE, useClass: PrismaPayoutAdminStore },
    ListPayoutQueue,
    RejectPayout,
    ReleasePayout,
    { provide: WEDDING_DELETION_STORE, useClass: PrismaWeddingDeletionStore },
    RequestWeddingDeletion,
    CancelWeddingDeletion,
    AdminRefund,
    AdminPaymentActions,
    ExtendAsCourtesy,
  ],
  exports: [
    AdminRefund,
    AdminPaymentActions,
    ExtendAsCourtesy,
    BlockWedding,
    PayPayout,
    RetryPayout,
    ListPayoutQueue,
    RejectPayout,
    ReleasePayout,
    PAYMENT_GATEWAY,
    LocalGatewayStore,
    ReceiveGatewayWebhook,
    ProcessGatewayEvent,
  ],
})
export class BillingModule {}
