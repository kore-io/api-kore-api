import type { QuoteTarget } from './quote-target.reader.port';

/** Um pagamento como o dono o lê (RLS: só nos casamentos de que é dono). */
export interface OwnedPayment {
  id: string;
  kind: 'publication' | 'extension';
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refund_requested' | 'refunded' | 'disputed';
  method: 'pix' | 'card';
  installments: number;
  amountCents: number;
  requestHash: string;
  gatewayPaymentId: string | null;
  pixCopyPaste: string | null;
  dueAt: Date | null;
  failureReason: string | null;
}

export interface NewPendingPayment {
  id: string;
  weddingId: string;
  kind: 'publication' | 'extension';
  method: 'pix' | 'card';
  installments: number;
  priceVersion: string;
  periodStart: string;
  periodEnd: string;
  monthsCovered: number;
  activationListCents: number;
  monthlyListCents: number;
  capDiscountCents: number;
  referralDiscountCents: number;
  pixDiscountCents: number;
  installmentInterestCents: number;
  amountCents: number;
  gateway: 'local' | 'asaas';
  payerName: string;
  payerTaxIdHash: string;
  payerTaxIdHashVersion: number;
  payerTaxIdLast4: string;
  idempotencyKey: string;
  requestHash: string;
  createdByUserId: string;
  previousEndDate: string | null;
  previousPaidThrough: string | null;
}

/**
 * O pedido de pagamento pelo app (Publicar e pagar RN03), na transação da
 * requisição, com a RLS do dono: insere só o pendente (RN20) e grava o passo 3
 * pela função SECURITY DEFINER.
 */
export interface PaymentRequestStore {
  /** O casamento travado (FOR UPDATE), com o indicador; nulo sem acesso. */
  lockWedding({ weddingId }: { weddingId: string }): Promise<QuoteTarget | null>;
  byIdempotencyKey(input: {
    weddingId: string;
    idempotencyKey: string;
  }): Promise<OwnedPayment | null>;
  /** Há um pendente desse tipo (RN07)? */
  hasPending(input: { weddingId: string; kind: 'publication' | 'extension' }): Promise<boolean>;
  /** Há uma publicação com reembolso em andamento (RN08, B2-9)? */
  hasRefundInProgress({ weddingId }: { weddingId: string }): Promise<boolean>;
  /** O pendente; o índice único do pendente vira PaymentPendingError. */
  insertPending({ payment }: { payment: NewPendingPayment }): Promise<void>;
  byId(input: { weddingId: string; paymentId: string }): Promise<OwnedPayment | null>;
  /** RN03, passo 3: false quando o pagamento já não estava pendente sem id do gateway. */
  recordCharge(input: {
    paymentId: string;
    gatewayPaymentId: string;
    refused: boolean;
    pixCopyPaste: string | null;
    dueAt: Date | null;
    cardLast4: string | null;
    failureReason: string | null;
  }): Promise<boolean>;
}

export const PAYMENT_REQUEST_STORE = Symbol('PaymentRequestStore');

/** O cliente do gateway por pagador (B2-11), pela conexão do backoffice (RN20). */
export interface GatewayCustomers {
  find(input: {
    weddingId: string;
    gateway: 'local' | 'asaas';
    payerTaxIdHash: string;
  }): Promise<string | null>;
  save(input: {
    weddingId: string;
    gateway: 'local' | 'asaas';
    payerTaxIdHash: string;
    gatewayCustomerId: string;
  }): Promise<string>;
}

export const GATEWAY_CUSTOMERS = Symbol('GatewayCustomers');
