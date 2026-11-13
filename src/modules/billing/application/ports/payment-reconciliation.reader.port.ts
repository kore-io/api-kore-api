/** Um pagamento que a reconciliação confere (Publicar e pagar RN11). */
export interface ReconcilingPayment {
  id: string;
  weddingId: string;
  kind: 'publication' | 'extension';
  method: 'pix' | 'card';
  status: 'pending' | 'paid' | 'failed' | 'canceled' | 'refund_requested' | 'refunded' | 'disputed';
  dueAt: Date | null;
  createdAt: Date;
  refundRequestedAt: Date | null;
  refundFailedAt: Date | null;
}

/**
 * As leituras da reconciliação (RN11), pela conexão do backoffice (worker),
 * fora da RLS por casamento. `weddingId` recorta a rodada a um casamento só
 * (o teste e a rota dev; a rotina roda sem ele).
 */
export interface PaymentReconciliationReader {
  /** Os pendentes criados antes do corte, inclusive os sem id do gateway (B2-1). */
  stalePending(input: {
    createdBefore: Date;
    weddingId?: string;
    limit: number;
  }): Promise<ReconcilingPayment[]>;
  /** Os `paid`, `refund_requested` e `disputed`, em páginas pelo id. */
  settled(input: {
    afterId: string | null;
    weddingId?: string;
    limit: number;
  }): Promise<ReconcilingPayment[]>;
  /**
   * Os estornos pedidos que nunca tentaram (Pagamentos e arrependimento RN04):
   * o job não entrou na fila depois do commit (Redis fora).
   */
  refundsNeverAttempted(input: {
    requestedBefore: Date;
    weddingId?: string;
    limit: number;
  }): Promise<{ id: string }[]>;
  /** Os pagamentos dessas referências (a referência é o id do Payment). */
  byReferences({ references }: { references: string[] }): Promise<ReconcilingPayment[]>;
}

export const PAYMENT_RECONCILIATION_READER = Symbol('PaymentReconciliationReader');
