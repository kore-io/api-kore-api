import { PAYOUT_TRANSFERS_QUEUE } from './infrastructure/jobs/payout-transfers.queue';
import { PayoutTransfersProcessor } from './infrastructure/jobs/payout-transfers.job';
import { COMMISSION_NOTICES } from './application/ports/commission-notices.port';
import { BullmqCommissionNotices } from './infrastructure/jobs/bullmq-commission-notices';
import { BullModule } from '@nestjs/bullmq';
import { WEDDING_RETENTION_STORE } from './application/ports/wedding-retention.port';
import { PurgeRetainedWeddings } from './application/wedding-lifecycle/purge-retained-weddings.use-case';
import { PrismaWeddingRetentionStore } from './infrastructure/backoffice/prisma-wedding-retention.store';
import { PurgeSoonGiveUpHandler } from './infrastructure/jobs/purge-soon-give-up.handler';
import { Module } from '@nestjs/common';
import { BlockWedding } from './application/wedding-lifecycle/block-wedding.use-case';
import { WEDDING_BLOCKS } from './application/ports/wedding-blocks.port';
import { PrismaWeddingBlocks } from './infrastructure/backoffice/prisma-wedding-blocks';
import { NOTIFICATIONS_QUEUE } from '@/modules/notifications/infrastructure/jobs/notifications-queue';
import { GATEWAY_EVENT_QUEUE } from './application/ports/gateway-event.queue.port';
import { GATEWAY_EVENT_STORE } from './application/ports/gateway-event.store.port';
import { ProcessGatewayEvent } from './application/payments/process-gateway-event.use-case';
import { RequeueGatewayEvents } from './application/payments/requeue-gateway-events.use-case';
import { PAYMENT_RECONCILIATION_READER } from './application/ports/payment-reconciliation.reader.port';
import { ReconcilePayments } from './application/payments/reconcile-payments.use-case';
import { ProcessRefund } from './application/refunds/process-refund.use-case';
import { AdvanceWeddingLifecycle } from './application/wedding-lifecycle/advance-wedding-lifecycle.use-case';
import { COMMISSION_RELEASE } from './application/ports/commission-release.port';
import { ReleaseCommissions } from './application/payouts/release-commissions.use-case';
import { PrismaCommissionRelease } from './infrastructure/backoffice/prisma-commission-release';
import { WEDDING_LIFECYCLE_STORE } from './application/ports/wedding-lifecycle.port';
import { PrismaWeddingLifecycleStore } from './infrastructure/backoffice/prisma-wedding-lifecycle.store';
import {
  WEDDING_LIFECYCLE_QUEUE,
  WeddingLifecycleProcessor,
  WeddingLifecycleScheduler,
} from './infrastructure/jobs/wedding-lifecycle.job';
import { PaymentRefundsProcessor } from './infrastructure/jobs/payment-refunds.job';
import { PAYMENT_REFUNDS_QUEUE } from './infrastructure/jobs/refunds.queue';
import { PrismaPaymentReconciliationReader } from './infrastructure/backoffice/prisma-payment-reconciliation.reader';
import {
  PAYMENT_RECONCILIATION_QUEUE,
  PaymentReconciliationProcessor,
  PaymentReconciliationScheduler,
} from './infrastructure/jobs/payment-reconciliation.job';
import { PrismaGatewayEventStore } from './infrastructure/backoffice/prisma-gateway-event.store';
import {
  GatewayEventsProcessor,
  GatewayEventsRequeueScheduler,
} from './infrastructure/jobs/gateway-events.job';
import {
  BullmqGatewayEventQueue,
  GATEWAY_EVENTS_QUEUE,
} from './infrastructure/jobs/gateway-events.queue';
import { PAYMENT_GATEWAY_PROVIDERS } from './infrastructure/backoffice/payment-gateway.providers';
import { PAYMENT_PROCESSING_PROVIDERS } from './infrastructure/providers/payment-processing.providers';
import { AppConfigService } from '@/shared/config/app-config.service';
import { EMAIL_OUTBOX } from '@/shared/email/application/email-outbox.port';
import { EMAIL_SENDER } from '@/shared/email/application/email-sender.port';
import { EmailQueuesModule } from '@/shared/email/email-queues.module';
import { BullmqEmailOutbox } from '@/shared/email/infrastructure/bullmq-email-outbox';
import { SmtpEmailSender } from '@/shared/email/infrastructure/smtp-email-sender';
import { PRODUCT_EVENT_RECORDER } from '@/modules/product-events/application/ports/product-event-recorder.port';
import { PrismaProductEventRecorder } from '@/modules/product-events/infrastructure/persistence/prisma-product-event-recorder';
import { WeddingPseudonymizer } from '@/modules/product-events/infrastructure/providers/wedding-pseudonymizer';

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
    BullModule.registerQueue({ name: PAYOUT_TRANSFERS_QUEUE }),
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
    { provide: COMMISSION_RELEASE, useClass: PrismaCommissionRelease },
    { provide: COMMISSION_NOTICES, useClass: BullmqCommissionNotices },
    ReleaseCommissions,
    { provide: WEDDING_RETENTION_STORE, useClass: PrismaWeddingRetentionStore },
    PurgeRetainedWeddings,
    PurgeSoonGiveUpHandler,
    WeddingLifecycleProcessor,
    PayoutTransfersProcessor,
    WeddingLifecycleScheduler,
  ],
})
export class BillingWorkerModule {}
