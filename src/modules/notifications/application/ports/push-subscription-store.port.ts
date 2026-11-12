/** As assinaturas de push da própria pessoa (E-mail e push RN07 e RN08), pela RLS. */
export interface PushSubscriptionStore {
  /**
   * Grava ou atualiza pelo endpoint, presa à sessão atual. A do mesmo endpoint
   * de outra pessoa sai antes (o aparelho trocou de dono; R8-7).
   */
  save({
    userId,
    sessionId,
    endpoint,
    p256dh,
    auth,
    userAgent,
  }: {
    userId: string;
    sessionId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
  }): Promise<void>;
  /** Apaga a deste aparelho; devolve quantas a pessoa ainda tem. */
  remove({ userId, endpoint }: { userId: string; endpoint: string }): Promise<number>;
  /** A preferência push do tipo nos casamentos em que a pessoa tem vínculo (217(8)). */
  setPushPreference({ userId, push }: { userId: string; push: boolean }): Promise<void>;
}

export const PUSH_SUBSCRIPTION_STORE = Symbol('PushSubscriptionStore');
