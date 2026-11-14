/**
 * As escritas e leituras das ações do Admin na Cobrança (Backoffice - cobrança
 * RN05, RN06 e RN11), pelo kore_backoffice, na transação corrente da
 * BackofficeTransaction. As regras ficam nos casos de uso; aqui, o banco.
 */
export interface AdminRefundOutcome {
  result:
    | 'requested'
    | 'already_requested'
    | 'disputed'
    | 'not_paid'
    | 'not_last_extension'
    | 'not_found';
  paymentIds: string[];
  method: 'pix' | 'card';
  paidAt: Date | null;
  /** O Pix de extensão pendente, quando o reembolsado é a publicação. */
  pendingExtensionId: string | null;
}

export interface CourtesyWedding {
  status: string;
  endDate: Date | null;
  paidThrough: Date | null;
  eventDate: Date | null;
  timezone: string | null;
}

export interface AdminBillingStore {
  /**
   * A `apply_payment_refund` com a origem admin, e o log `payment.refund_requested`
   * de cada pagamento que ela levou (o motivo vai ao log, não ao refundReason).
   */
  requestRefund(input: {
    paymentId: string;
    adminUserId: string;
    reason: string | null;
    now: Date;
  }): Promise<AdminRefundOutcome>;

  /** Tira a desistência do estorno e grava `payment.refund_retried`. */
  clearRefundFailure(input: {
    paymentId: string;
    weddingId: string;
    adminUserId: string;
    reason: string;
    attempt: number;
    now: Date;
  }): Promise<void>;

  paymentStatus(input: { paymentId: string }): Promise<string | null>;
  /** `undefined`: o pagamento não existe; `null`: sem comprovante. */
  receiptKeyOf(input: { paymentId: string }): Promise<string | null | undefined>;

  /** Trava o casamento para a cortesia; nulo se não existe (ou expurgado). */
  lockWeddingForCourtesy(input: { weddingId: string }): Promise<CourtesyWedding | null>;
  /**
   * A CourtesyExtension, a endDate e o paidThrough com as transições da Data
   * de saída do ar RN04, o log `wedding.courtesy_extended` e a notificação
   * `billing` às pessoas donas. Devolve os Pix de extensão pendentes.
   */
  recordCourtesy(input: {
    weddingId: string;
    adminUserId: string;
    months: number;
    reason: string;
    previous: CourtesyWedding;
    previousEndDate: string;
    periodStart: string;
    newEndDate: string;
    now: Date;
  }): Promise<{ pendingExtensionIds: string[] }>;

  /** As ações dos alertas (RN11), dentro da transação do SyncPaymentWithGateway. */
  hasOpenAlert(input: {
    paymentId: string;
    type: 'gateway_amount_mismatch' | 'refund_failed';
  }): Promise<boolean>;
  markAppliedByAdmin(input: { paymentId: string; now: Date }): Promise<void>;
  markRefundedOutside(input: { paymentId: string; receiptKey: string }): Promise<void>;
  log(input: {
    action: string;
    weddingId: string;
    paymentId: string;
    adminUserId: string;
    data: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  resolveAlerts(input: {
    paymentId: string;
    types: ('gateway_amount_mismatch' | 'refund_failed')[];
    adminUserId: string;
    now: Date;
  }): Promise<void>;
}

export const ADMIN_BILLING_STORE = Symbol('AdminBillingStore');
