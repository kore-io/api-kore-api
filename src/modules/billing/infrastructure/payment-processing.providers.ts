import { ADMIN_BILLING_STORE } from '../application/ports/admin-billing.store.port';
import { PrismaAdminBillingStore } from './backoffice/prisma-admin-billing.store';
import type { Provider } from '@nestjs/common';
import { PAYMENT_LEDGER } from '../application/ports/payment-ledger.port';
import { BILLING_MAILER } from '../application/ports/billing-mailer.port';
import { BILLING_PUSH } from '../application/ports/billing-push.port';
import { BullmqBillingPush } from './bullmq-billing-push';
import { REFUND_QUEUE } from '../application/ports/refund-queue.port';
import { CancelPendingPayment } from '../application/cancel-pending-payment';
import { BullmqRefundQueue } from './refunds.queue';
import { SyncPaymentWithGateway } from '../application/sync-payment.use-case';
import { PrismaPaymentLedger } from './backoffice/prisma-payment-ledger';
import { OutboxBillingMailer } from './outbox-billing-mailer';
import { PAYOUT_LEDGER } from '../application/ports/payout-ledger.port';
import { PAYOUT_TRANSFER_QUEUE } from '../application/ports/payout-transfer-queue.port';
import {
  PayPayout,
  ReconcilePayouts,
  RetryPayout,
  SendPayoutTransfer,
  SyncPayout,
} from '../application/payouts/payout-transfers.use-cases';
import { PrismaPayoutLedger } from './backoffice/prisma-payout-ledger';
import { BullmqPayoutTransferQueue } from './payout-transfers.queue';

/**
 * A aplicação do estado do gateway ao Payment (Publicar e pagar RN05 e RN09),
 * montada na API (a rota dev processa em linha) e no worker (a fila). Quem
 * importa registra a fila das notificações (o push da cobrança) e a dos
 * estornos.
 */
export const PAYMENT_PROCESSING_PROVIDERS: Provider[] = [
  { provide: PAYMENT_LEDGER, useClass: PrismaPaymentLedger },
  { provide: ADMIN_BILLING_STORE, useClass: PrismaAdminBillingStore },
  { provide: BILLING_MAILER, useClass: OutboxBillingMailer },
  { provide: BILLING_PUSH, useClass: BullmqBillingPush },
  { provide: REFUND_QUEUE, useClass: BullmqRefundQueue },
  CancelPendingPayment,
  SyncPaymentWithGateway,
  // O Pix de saída do repasse (Repasse RN05): o webhook transfer.* chega pela
  // mesma rota e fila dos eventos do gateway. Quem importa registra a fila
  // payout-transfers.
  { provide: PAYOUT_LEDGER, useClass: PrismaPayoutLedger },
  { provide: PAYOUT_TRANSFER_QUEUE, useClass: BullmqPayoutTransferQueue },
  SyncPayout,
  PayPayout,
  SendPayoutTransfer,
  RetryPayout,
  ReconcilePayouts,
];
