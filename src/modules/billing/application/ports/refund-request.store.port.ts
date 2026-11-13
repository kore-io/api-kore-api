export type RefundRequestResult =
  | 'requested'
  | 'not_found'
  | 'blocked'
  | 'already_requested'
  | 'disputed'
  | 'not_paid'
  | 'window_closed'
  | 'not_last_extension';

/** O pagamento como o log do pedido o registra (RN09). */
export interface RefundedPaymentRow {
  id: string;
  kind: 'publication' | 'extension';
  amountCents: number;
}

/**
 * O pedido de desistência pelo app (Pagamentos e arrependimento RN02 a RN04),
 * na transação da requisição, com a RLS do dono; o estado muda pela função
 * SECURITY DEFINER `request_payment_refund` (Publicar e pagar RN20).
 */
export interface RefundRequestStore {
  request(input: {
    /** O casamento do pedido: o pagamento de outro casamento é not_found. */
    weddingId: string;
    paymentId: string;
    reason: string | null;
    now: Date;
    alertId: string;
  }): Promise<{ result: RefundRequestResult; paymentIds: string[]; refundableUntil: Date | null }>;
  payments(input: { weddingId: string; ids: string[] }): Promise<RefundedPaymentRow[]>;
  /** O Pix de extensão pendente, que o pedido de publicação cancela (RN03). */
  pendingExtensionId({ weddingId }: { weddingId: string }): Promise<string | null>;
}

export const REFUND_REQUEST_STORE = Symbol('RefundRequestStore');
