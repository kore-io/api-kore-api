/** Os tipos da F5 (Central RN01): só a resposta do convite. */
export const NOTIFICATION_TYPES = ['rsvp'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type EmailFrequency = 'off' | 'immediate' | 'daily';

export interface NotificationRow {
  id: string;
  type: NotificationType;
  /** Grupos distintos no payload (Central RN04). */
  count: number;
  /** Por grupo: { partyId, name, confirmed, declined, at }; sem restrição nem música. */
  payload: unknown;
  readAt: Date | null;
  updatedAt: Date;
}

export interface PreferenceRow {
  type: NotificationType;
  inApp: boolean;
  email: EmailFrequency;
  push: boolean;
}

/**
 * A central e as preferências, na transação da requisição (RLS: só da própria
 * pessoa e só dos casamentos em que ela tem vínculo, Central RN09).
 */
export interface NotificationStore {
  list({
    userId,
    weddingId,
    type,
    after,
    limit,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType | null;
    after: { updatedAt: Date; id: string } | null;
    limit: number;
  }): Promise<NotificationRow[]>;
  unreadCount({ userId, weddingId }: { userId: string; weddingId: string }): Promise<number>;
  /** Marca como lida; false quando a notificação não é da pessoa (ou não existe). */
  markRead({ userId, id, now }: { userId: string; id: string; now: Date }): Promise<boolean>;
  markAllRead({
    userId,
    weddingId,
    now,
  }: {
    userId: string;
    weddingId: string;
    now: Date;
  }): Promise<void>;
  preferences({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<PreferenceRow[]>;
  saveEmailPreference({
    userId,
    weddingId,
    type,
    email,
  }: {
    userId: string;
    weddingId: string;
    type: NotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow>;
  /** Este aparelho (a sessão) tem assinatura de push. */
  hasPushSubscription({ sessionId }: { sessionId: string }): Promise<boolean>;
}

export const NOTIFICATION_STORE = Symbol('NotificationStore');
