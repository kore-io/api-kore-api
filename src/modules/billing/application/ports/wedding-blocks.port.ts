/** O bloqueio do casamento, pela transação do backoffice (Casamento bloqueado RN01). */
export interface WeddingBlocks {
  block(input: {
    weddingId: string;
    byUserId: string;
    reason: string;
    /** O hash do IP de quem bloqueou (a rota do staff), para o log. */
    ipHash?: string | null;
    now: Date;
  }): Promise<'blocked' | 'already_blocked' | 'not_found'>;
  unblock(input: {
    weddingId: string;
    byUserId: string;
    reason: string | null;
    ipHash?: string | null;
    now: Date;
  }): Promise<'unblocked' | 'not_blocked' | 'not_found'>;
  /** Os pagamentos pendentes (publicação e extensão), para cancelar na porta (RN06). */
  pendingPaymentIds({ weddingId }: { weddingId: string }): Promise<string[]>;
}

export const WEDDING_BLOCKS = Symbol('WeddingBlocks');
