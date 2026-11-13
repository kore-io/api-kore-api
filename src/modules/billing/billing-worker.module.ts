import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BlockWedding } from './application/block-wedding.use-case';
import { WEDDING_BLOCKS } from './application/ports/wedding-blocks.port';
import { PrismaWeddingBlocks } from './infrastructure/backoffice/prisma-wedding-blocks';
import { NOTIFICATIONS_QUEUE } from '../notifications/infrastructure/notifications-queue';
import { GATEWAY_EVENT_QUEUE } from './application/ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE } from './application/ports/gateway-event.store.port';
import { ProcessGatewayEvent } from './application/process-gateway-event.use-case';
import { RequeueGatewayEvents } from './application/requeue-gateway-events.use-case';
import { PAYMENT_RECONCILIATION_READER } from './application/ports/payment-reconciliation.reader.port';
import { ReconcilePayments } from './application/reconcile-payments.use-case';
import { ProcessRefund } from './application/process-refund.use-case';
import { AdvanceWeddingLifecycle } from './application/advance-wedding-lifecycle.use-case';
import { WEDDING_LIFECYCLE_STORE } from './application/ports/wedding-lifecycle.port';
import { PrismaWeddingLifecycleStore } from './infrastructure/backoffice/prisma-wedding-lifecycle.store';
import {
  WEDDING_LIFECYCLE_QUEUE,
  WeddingLifecycleProcessor,
  WeddingLifecycleScheduler,
} from './infrastructure/wedding-lifecycle.job';
import { PaymentRefundsProcessor } from './infrastructure/payment-refunds.job';
import { PAYMENT_REFUNDS_QUEUE } from './infrastructure/refunds.queue';
import { PrismaPaymentReconciliationReader } from './infrastructure/backoffice/prisma-payment-reconciliation.reader';
import {
  PAYMENT_RECONCILIATION_QUEUE,
  PaymentReconciliationProcessor,
  PaymentReconciliationScheduler,
} from './infrastructure/payment-reconciliation.job';
import { PrismaGatewayEventStore } from './infrastructure/backoffice/prisma-gateway-event.store';
import {
  GatewayEventsProcessor,
  GatewayEventsRequeueScheduler,
} from './infrastructure/gateway-events.job';
import {
  BullmqGatewayEventQueue,
  GATEWAY_EVENTS_QUEUE,
} from './infrastructure/gateway-events.queue';
import { PAYMENT_GATEWAY_PROVIDERS } from './infrastructure/backoffice/payment-gateway.providers';
import { PAYMENT_PROCESSING_PROVIDERS } from './infrastructure/payment-processing.providers';
import { AppConfigService } from '../../shared/config/app-config.service';
import { EMAIL_OUTBOX } from '../../shared/email/application/email-outbox.port';
import { EMAIL_SENDER } from '../../shared/email/application/email-sender.port';
import { EmailQueuesModule } from '../../shared/email/email-queues.module';
import { BullmqEmailOutbox } from '../../shared/email/infrastructure/bullmq-email-outbox';
import { SmtpEmailSender } from '../../shared/email/infrastructure/smtp-email-sender';
import { PRODUCT_EVENT_RECORDER } from '../product-events/application/ports/product-event-recorder.port';
import { PrismaProductEventRecorder } from '../product-events/infrastructure/prisma-product-event-recorder';
import { WeddingPseudonymizer } from '../product-events/infrastructure/wedding-pseudonymizer';

/**
 * Cobrança e publicação (F3), do lado do worker: o processamento dos eventos
 * do gateway e a reconciliação (RN11).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: GATEWAY_EVENTS_QUEUE }),
    BullModule.registerQueue({ name: PAYMENT_RECONCILIATION_QUEUE }),
    // O push da cobrança entra na fila das notificações (decisão 236).
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    BullModule.registerQueue({ name: PAYMENT_REFUNDS_QUEUE }),
    BullModule.registerQueue({ name: WEDDING_LIFECYCLE_QUEUE }),
    // O e-mail do pagamento confirmado entra na fila de e-mail, como na API.
    EmailQueuesModule,
  ],
  providers: [
    ...PAYMENT_GATEWAY_PROVIDERS,
    ...PAYMENT_PROCESSING_PROVIDERS,
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    { provide: EMAIL_OUTBOX, useClass: BullmqEmailOutbox },
    {
      provide: WeddingPseudonymizer,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new WeddingPseudonymizer({ keyBase64: config.get({ key: 'PRODUCT_EVENT_KEY' }) }),
    },
    // O evento de produto `publicado` da primeira publicação (decisão 216, D29).
    { provide: PRODUCT_EVENT_RECORDER, useClass: PrismaProductEventRecorder },
    { provide: GATEWAY_EVENT_STORE, useClass: PrismaGatewayEventStore },
    { provide: GATEWAY_EVENT_QUEUE, useClass: BullmqGatewayEventQueue },
    ProcessGatewayEvent,
    RequeueGatewayEvents,
    GatewayEventsProcessor,
    GatewayEventsRequeueScheduler,
    { provide: PAYMENT_RECONCILIATION_READER, useClass: PrismaPaymentReconciliationReader },
    ReconcilePayments,
    PaymentReconciliationProcessor,
    PaymentReconciliationScheduler,
    ProcessRefund,
    PaymentRefundsProcessor,
    { provide: WEDDING_BLOCKS, useClass: PrismaWeddingBlocks },
    BlockWedding,
    { provide: WEDDING_LIFECYCLE_STORE, useClass: PrismaWeddingLifecycleStore },
    AdvanceWeddingLifecycle,
    WeddingLifecycleProcessor,
    WeddingLifecycleScheduler,
  ],
})
export class BillingWorkerModule {}
