import type { Provider } from '@nestjs/common';
import { PAYMENT_LEDGER } from '../application/ports/payment-ledger.port';
import { BILLING_MAILER } from '../application/ports/billing-mailer.port';
import { BILLING_PUSH } from '../application/ports/billing-push.port';
import { BullmqBillingPush } from './bullmq-billing-push';
import { SyncPaymentWithGateway } from '../application/sync-payment.use-case';
import { PrismaPaymentLedger } from './backoffice/prisma-payment-ledger';
import { OutboxBillingMailer } from './outbox-billing-mailer';

/**
 * A aplicação do estado do gateway ao Payment (Publicar e pagar RN05 e RN09),
 * montada na API (a rota dev processa em linha) e no worker (a fila). Quem
 * importa registra a fila das notificações (o push da cobrança).
 */
export const PAYMENT_PROCESSING_PROVIDERS: Provider[] = [
  { provide: PAYMENT_LEDGER, useClass: PrismaPaymentLedger },
  { provide: BILLING_MAILER, useClass: OutboxBillingMailer },
  { provide: BILLING_PUSH, useClass: BullmqBillingPush },
  SyncPaymentWithGateway,
];
