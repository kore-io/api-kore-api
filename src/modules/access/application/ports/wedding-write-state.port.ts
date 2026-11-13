/**
 * O casamento aceita escrita (Casamento bloqueado RN02; Retenção RN05)? Só
 * para quem tem vínculo ativo com ele: a quem não tem, nulo (a rota responde
 * 404 como sempre, e o bloqueio não vaza).
 */
export interface WeddingWriteState {
  blockOf(input: {
    userId: string;
    weddingId: string;
  }): Promise<'blocked' | 'deletion_scheduled' | null>;
  /**
   * O mesmo, pelo casamento do convite (Casamento bloqueado RN02: os convites
   * de acesso): quem aceita ainda não tem vínculo, e o token válido já mostra
   * que o casamento existe.
   */
  blockOfInvitedWedding({
    weddingId,
  }: {
    weddingId: string;
  }): Promise<'blocked' | 'deletion_scheduled' | null>;
}

export const WEDDING_WRITE_STATE = Symbol('WeddingWriteState');
