/** As datas e o status do casamento (Publicar e pagar, GET …/billing): todos os vínculos leem. */
export interface BillingLifecycle {
  status: string;
  publishedAt: Date | null;
  endDate: string | null;
  paidThrough: string | null;
  graceUntil: string | null;
  expiredAt: string | null;
  purgeAt: string | null;
  publicationSource: 'courtesy' | 'payment' | null;
  /** O booleano da função (RN06; G3): sem valores. */
  awaitingPayment: boolean;
}

export interface BillingPendingPayment {
  paymentId: string;
  kind: 'publication' | 'extension';
  method: 'pix' | 'card';
  amountCents: number;
  dueAt: Date | null;
  pixCopyPaste: string | null;
}

export interface BillingPaymentRow {
  id: string;
  kind: 'publication' | 'extension';
  periodStart: string;
  periodEnd: string;
  monthsCovered: number;
  amountCents: number;
  method: 'pix' | 'card';
  installments: number;
  status: string;
  paidAt: Date | null;
  /**
   * O último instante para desistir (Pagamentos e arrependimento RN02), no fuso
   * do casamento; só no pago e dentro do prazo.
   */
  refundableUntil: Date | null;
  /** O prazo da defesa na contestação (RN06), AAAA-MM-DD; só no `disputed`. */
  disputeDeadline: string | null;
}

/** Só o dono (RLS de payments): o pendente, os pagamentos aplicados e o último pagador. */
export interface BillingMoneyView {
  pendingPayment: BillingPendingPayment | null;
  payments: BillingPaymentRow[];
  lastPayer: { name: string; taxIdLast4: string } | null;
}

export interface BillingViewReader {
  lifecycle({ weddingId }: { weddingId: string }): Promise<BillingLifecycle | null>;
  money({ weddingId, now }: { weddingId: string; now: Date }): Promise<BillingMoneyView>;
}

export const BILLING_VIEW_READER = Symbol('BillingViewReader');
