import type { AlertType } from '../../../../generated/prisma/client';
import type { ConfirmingPayment, ConfirmingWedding } from '../../domain/payment-confirmation';

export interface LedgerWedding extends ConfirmingWedding {
  id: string;
  publishedAt: Date | null;
  endDate: string | null;
  paidThrough: string | null;
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
  cardLast4: string | null;
  /** O estorno (Pagamentos e arrependimento RN04 e RN05). */
  refundOrigin: 'couple' | 'admin' | 'automatic' | 'chargeback' | 'manual' | null;
  refundRequestedAt: Date | null;
  refundAttempts: number;
  /** O erro da tentativa em curso; nulo enquanto ela não falhou (RN05). */
  refundLastError: string | null;
  refundFailedAt: Date | null;
  /** A contestação (Pagamentos e arrependimento RN06); aberta sem a data de resolução. */
  disputedAt: Date | null;
  disputeResolvedAt: Date | null;
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
  /**
   * A extensão paga (Data de saída do ar RN04): endDate e paidThrough na nova
   * data; a carência volta a published (casamento ainda por vir) ou
   * post_event; o expirado volta a post_event, sem expiredAt, purgeAt nem
   * purgeNoticeSentAt (B4-3). Grava no Payment a data e o paidThrough de
   * antes, para a desistência voltar (Pagamentos e arrependimento RN03).
   */
  extend(input: {
    weddingId: string;
    paymentId: string;
    endDate: string;
    now: Date;
  }): Promise<void>;
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
    /** Um aviso por pagamento e fato: a confirmação e o reembolso concluído (RN13; RN07). */
    event: 'payment_confirmed' | 'refund_completed';
    userIds: string[];
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  /**
   * O aviso de saída do ar na central (Data de saída do ar RN03): a notificação
   * `billing` às pessoas donas, uma por aviso e endDate.
   */
  notifyEndDateNotice(input: {
    weddingId: string;
    notice: 'end_date_in_7_days' | 'grace_day_1' | 'grace_day_5' | 'expired';
    endDate: string;
    userIds: string[];
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  /** O `wedding_published` da primeira publicação ao indicador (G5). */
  notifyWeddingPublished(input: { weddingId: string; now: Date }): Promise<void>;
  /** O pago sem destino vira estorno automático (Publicar e pagar RN08). */
  requestAutomaticRefund(input: { paymentId: string; now: Date }): Promise<void>;
  /** Uma chamada de estorno à porta (RN05): conta a tentativa e limpa o erro. */
  countRefundAttempt(input: { paymentId: string }): Promise<number>;
  /** A tentativa falhou; `gaveUp` grava o refundFailedAt (RN05). */
  recordRefundFailure(input: {
    paymentId: string;
    error: string;
    gaveUp: boolean;
    now: Date;
  }): Promise<void>;
  /** O gateway estornou (RN03): refunded, com a hora. */
  markRefunded(input: { paymentId: string; now: Date }): Promise<void>;
  /** Os pagamentos do mesmo pedido (mesmo casamento e mesma hora): o alerta os cita (B3-3). */
  sameRefundRequest(input: {
    weddingId: string;
    refundRequestedAt: Date;
  }): Promise<{ id: string; shortCode: number }[]>;
  /**
   * A contestação aberta (RN06): `paid → disputed`; com o pagamento em
   * `refund_requested`, grava só a data e o prazo e mantém o estado (RN10).
   */
  markDisputed(input: {
    paymentId: string;
    now: Date;
    deadline: string | null;
    keepStatus: boolean;
  }): Promise<void>;
  /** Contestação ganha (RN06): `disputed → paid`. */
  markDisputeWon(input: { paymentId: string; now: Date }): Promise<void>;
  /**
   * Contestação perdida (RN06; B3-4): `refunded` com origem `chargeback`, sem
   * cascata (do `disputed`, ou do `paid` quando a abertura não chegou); o
   * `refund_requested` vai a `refunded` com a origem do pedido.
   */
  markDisputeLost(input: { paymentId: string; now: Date }): Promise<void>;
  /**
   * Grava o aviso de saída do ar (Data de saída do ar RN03): um por casamento,
   * tipo e endDate (o único do BillingNoticeLog); false quando já foi enviado.
   */
  recordBillingNotice(input: {
    weddingId: string;
    notice: 'end_date_in_7_days' | 'grace_day_1' | 'grace_day_5' | 'expired';
    endDate: string;
    now: Date;
  }): Promise<boolean>;
  /**
   * A comissão do pagamento aplicado (Comissões RN01, RN03 e RN04), na mesma
   * transação, com o indicador travado depois do Payment (RN18). Sem
   * indicador, ou com o resultado zero, não nasce; a repetida não nasce de novo.
   */
  createCommission(input: { weddingId: string; paymentId: string; now: Date }): Promise<void>;
  /** No pedido do reembolso e na contestação (RN05 e RN06): pending · available → held. */
  holdCommission(input: { paymentId: string; now: Date }): Promise<void>;
  /** Contestação ganha (RN06): held → available ou pending, pelo availableAt. */
  releaseCommission(input: { paymentId: string; now: Date }): Promise<void>;
  /**
   * Reembolso confirmado ou contestação perdida (RN05): fora de repasse ou num
   * repasse pedido ou retido → reversed (o repasse fica retido, Repasse RN06);
   * já paga → um ajuste negativo do mesmo valor (`refund` ou `chargeback`). No
   * repasse em processamento, o Pix de saída decide (PR 9c).
   */
  reverseCommission(input: {
    paymentId: string;
    now: Date;
    reason: 'refund' | 'chargeback';
  }): Promise<void>;
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
