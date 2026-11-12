import type { Provider } from '@nestjs/common';
import { PAYMENT_LEDGER } from '../application/ports/payment-ledger.port';
import { BILLING_MAILER } from '../application/ports/billing-mailer.port';
import { SyncPaymentWithGateway } from '../application/sync-payment.use-case';
import { PrismaPaymentLedger } from './backoffice/prisma-payment-ledger';
import { OutboxBillingMailer } from './outbox-billing-mailer';

/**
 * A aplicação do estado do gateway ao Payment (Publicar e pagar RN05 e RN09),
 * montada na API (a rota dev processa em linha) e no worker (a fila).
 */
export const PAYMENT_PROCESSING_PROVIDERS: Provider[] = [
  { provide: PAYMENT_LEDGER, useClass: PrismaPaymentLedger },
  { provide: BILLING_MAILER, useClass: OutboxBillingMailer },
  SyncPaymentWithGateway,
];
