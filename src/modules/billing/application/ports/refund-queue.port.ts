/**
 * O estorno pela porta, por job e depois do commit (Pagamentos e arrependimento
 * RN04; G1). O id do job é fixo por pagamento e tentativa: o mesmo pedido não
 * chama a porta duas vezes.
 */
export interface RefundQueue {
  enqueue(input: { paymentId: string; attempt: number; delayMs: number }): Promise<void>;
}

export const REFUND_QUEUE = Symbol('RefundQueue');
