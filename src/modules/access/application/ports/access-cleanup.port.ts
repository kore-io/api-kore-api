/** Apaga do banco o que já não vale para entrar no Kore. */
export interface AccessCleanup {
  /** Sessões vencidas (RN08) ou encerradas (RN09, RN11). */
  deleteEndedSessions({ now }: { now: Date }): Promise<number>;
  /**
   * Pedidos de login criados antes de `createdBefore`. O corte é a janela da
   * RN04 (1 hora): o limite de 5 por hora conta também os pedidos usados e
   * invalidados, então eles só saem depois que deixam de contar. Todo pedido
   * dessa idade já venceu (vale 15 minutos, RN02).
   */
  deleteLoginChallengesCreatedBefore({ createdBefore }: { createdBefore: Date }): Promise<number>;
  /** O token cifrado do link do casal que já venceu (Meus casamentos RN09; N1(b)). */
  clearExpiredCoupleLinkTokens({ now }: { now: Date }): Promise<number>;
}

export const ACCESS_CLEANUP = Symbol('AccessCleanup');
