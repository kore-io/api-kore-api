import type { AlertType } from '../../../../generated/prisma/client';
import type { ConfirmingPayment, ConfirmingWedding } from '../../domain/payment-confirmation';

export interface LedgerWedding extends ConfirmingWedding {
  id: string;
  publishedAt: Date | null;
  timezone: string | null;
  eventDate: string | null;
}

export interface LedgerPayment extends ConfirmingPayment {
  id: string;
  weddingId: string;
  method: 'pix' | 'card';
  installments: number;
  periodStart: string;
  periodEnd: string;
  appliedAt: Date | null;
  createdByUserId: string | null;
  gatewayPaymentId: string | null;
  shortCode: number;
  /** O vencimento do Pix (RN11); nulo no cartão e antes do passo 3 da RN03. */
  dueAt: Date | null;
  createdAt: Date;
}

/** Quem recebe o aviso da cobrança (RN13): as pessoas donas, com o nome do e-mail. */
export interface BillingRecipient {
  userId: string;
  email: string;
  firstName: string;
}

export interface LedgerLogEntry {
  action: string;
  weddingId: string | null;
  entityType: string;
  entityId: string;
  data?: Record<string, unknown>;
}

/**
 * As escritas do dinheiro pelo worker (kore_backoffice; Publicar e pagar RN05,
 * RN08 a RN10 e RN20), sempre dentro da BackofficeTransaction, na ordem única
 * de trava da RN18 (Wedding → Payment).
 */
export interface PaymentLedger {
  /** Trava o casamento e depois o pagamento; nulo quando o pagamento não existe. */
  lock({
    paymentId,
  }: {
    paymentId: string;
  }): Promise<{ wedding: LedgerWedding; payment: LedgerPayment } | null>;
  otherPublicationApplied(input: { weddingId: string; paymentId: string }): Promise<boolean>;
  markPaid(input: {
    paymentId: string;
    paidAt: Date;
    chargedCents: number;
    feeCents: number | null;
    netCents: number | null;
    gatewayPaymentId: string;
    cardLast4: string | null;
  }): Promise<void>;
  markApplied(input: { paymentId: string; now: Date }): Promise<void>;
  markFailed(input: { paymentId: string; reason: string; gatewayPaymentId: string }): Promise<void>;
  markCanceled(input: { paymentId: string; now: Date }): Promise<void>;
  /** A publicação paga (RN05): status, datas, paidThrough, origem e quem publicou. */
  publish(input: {
    weddingId: string;
    endDate: string;
    publishedByUserId: string | null;
    now: Date;
  }): Promise<void>;
  billingRecipients({ weddingId }: { weddingId: string }): Promise<BillingRecipient[]>;
  partnerNames({ weddingId }: { weddingId: string }): Promise<[string, string]>;
  /** A notificação `billing` às pessoas donas (RN13), uma por pessoa e pagamento. */
  notifyBilling(input: {
    weddingId: string;
    paymentId: string;
    userIds: string[];
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  /** O `wedding_published` da primeira publicação ao indicador (G5). */
  notifyWeddingPublished(input: { weddingId: string; now: Date }): Promise<void>;
  /** Um alerta aberto por tipo e entidade (B9-7): o repetido não abre outro. */
  openAlert(input: {
    type: AlertType;
    weddingId: string | null;
    entityType: string;
    entityId: string;
    data: Record<string, unknown>;
  }): Promise<void>;
  log({ entry }: { entry: LedgerLogEntry }): Promise<void>;
}

export const PAYMENT_LEDGER = Symbol('PaymentLedger');
