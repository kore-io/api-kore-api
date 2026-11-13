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

/**
 * A aplicação do estado do gateway ao Payment (Publicar e pagar RN05 e RN09),
 * montada na API (a rota dev processa em linha) e no worker (a fila). Quem
 * importa registra a fila das notificações (o push da cobrança) e a dos
 * estornos.
 */
export const PAYMENT_PROCESSING_PROVIDERS: Provider[] = [
  { provide: PAYMENT_LEDGER, useClass: PrismaPaymentLedger },
  { provide: BILLING_MAILER, useClass: OutboxBillingMailer },
  { provide: BILLING_PUSH, useClass: BullmqBillingPush },
  { provide: REFUND_QUEUE, useClass: BullmqRefundQueue },
  CancelPendingPayment,
  SyncPaymentWithGateway,
];
