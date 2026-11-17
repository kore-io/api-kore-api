/**
 * O estorno pela porta, por job e depois do commit (Pagamentos e arrependimento
 * RN04; G1). O id do job é fixo por pagamento e tentativa: o mesmo pedido não
 * chama a porta duas vezes.
 */
export interface RefundQueue {
  /**
   * `series`: o Tentar o estorno de novo do Admin recomeça a contagem
   * (Pagamentos RN05), e a tentativa 1 da série nova tem um id próprio.
   */
  enqueue(input: {
    paymentId: string;
    attempt: number;
    delayMs: number;
    series?: string;
  }): Promise<void>;
  /**
   * O cancelamento do pendente pela porta, depois do commit do bloqueio
   * (Casamento bloqueado RN06; G1 e B8-5) ou da exclusão pedida (Retenção
   * RN06), com o id fixo por pagamento. Sem o motivo, o bloqueio.
   */
  enqueueCancel(input: {
    paymentId: string;
    reason?: 'wedding_blocked' | 'wedding_deletion' | 'courtesy_extended';
  }): Promise<void>;
}

export const REFUND_QUEUE = Symbol('RefundQueue');
