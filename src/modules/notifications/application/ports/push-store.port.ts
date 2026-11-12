/** Uma assinatura de push, com a sessão dela. */
export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Sessão revogada (Sair) ou vencida: a assinatura é ignorada e apagada (RN08). */
  sessionActive: boolean;
}

/** O que o push precisa, pela conexão do backoffice (o worker). */
export interface PushStore {
  /** Vínculo ativo e a preferência push do tipo (sem linha, desligado). */
  recipient({ userId, weddingId, now }: { userId: string; weddingId: string; now: Date }): Promise<{
    member: boolean;
    push: boolean;
    subscriptions: StoredPushSubscription[];
    /** A notificação não lida do casamento: o que o aviso mostra. */
    notification: { groupKey: string; count: number; firstGroupName: string | null } | null;
  }>;
  remove({ ids }: { ids: readonly string[] }): Promise<void>;
  markSuccess({ ids, now }: { ids: readonly string[]; now: Date }): Promise<void>;
}

export const PUSH_STORE = Symbol('PushStore');
