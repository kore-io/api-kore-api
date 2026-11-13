/** Uma assinatura de push, com a sessão dela. */
export interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Sessão revogada (Sair) ou vencida: a assinatura é ignorada e apagada (RN08). */
  sessionActive: boolean;
}

/** O tipo do aviso: a resposta, a cobrança (RN13) ou a comissão disponível (Comissões RN09). */
export type PushType = 'rsvp' | 'billing' | 'commission';

/** O que o push precisa, pela conexão do backoffice (o worker). */
export interface PushStore {
  /** Vínculo ativo e a preferência push do tipo (sem linha, desligado). */
  recipient({
    userId,
    weddingId,
    type,
    now,
  }: {
    userId: string;
    weddingId: string;
    /** O tipo do aviso: a preferência e a notificação são as dele. */
    type: PushType;
    now: Date;
  }): Promise<{
    member: boolean;
    /** O dono ou a cerimonialista com Planner, conferido agora (D18); nulo sem vínculo. */
    role: 'owner' | 'planner' | null;
    partnerNames: [string, string];
    /** A preferência push: a do casamento para o dono, a geral para a cerimonialista. */
    push: boolean;
    subscriptions: StoredPushSubscription[];
    /** A notificação não lida do casamento: o que o aviso mostra. */
    notification: { groupKey: string; count: number; firstGroupName: string | null } | null;
  }>;
  remove({ ids }: { ids: readonly string[] }): Promise<void>;
  markSuccess({ ids, now }: { ids: readonly string[]; now: Date }): Promise<void>;
}

export const PUSH_STORE = Symbol('PushStore');
