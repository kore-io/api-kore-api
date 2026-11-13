/**
 * Os tipos da central do casal (Central RN01): a resposta do convite e, desde
 * a F3, a cobrança (Publicar e pagar RN13).
 */
export const NOTIFICATION_TYPES = ['rsvp', 'billing'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Os tipos do casal com o e-mail escolhido na preferência (Central RN07). Os
 * e-mails da cobrança sempre saem, na hora (decisão 236).
 */
export const EMAIL_PREFERENCE_TYPES = ['rsvp'] as const;

/**
 * Os tipos da cerimonialista (Notificações da cerimonialista RN01): Novas
 * respostas, Casamento publicado, Colaboração encerrada e, desde a F3,
 * Comissão (Comissões do indicador RN09).
 */
export const PLANNER_NOTIFICATION_TYPES = [
  'rsvp',
  'wedding_published',
  'membership_removed',
  'commission',
] as const;
export type PlannerNotificationType = (typeof PLANNER_NOTIFICATION_TYPES)[number];

/** Todo tipo que alguma central mostra (a do casal e a da cerimonialista). */
export const CENTER_NOTIFICATION_TYPES = [...PLANNER_NOTIFICATION_TYPES, 'billing'] as const;
export type CenterNotificationType = (typeof CENTER_NOTIFICATION_TYPES)[number];

export type EmailFrequency = 'off' | 'immediate' | 'daily';

export interface NotificationRow {
  id: string;
  type: CenterNotificationType;
  /** A central da cerimonialista junta vários casamentos (revisão C8-5). */
  weddingId: string;
  /** Os primeiros nomes do casal; o app junta. */
  partnerNames: [string, string];
  /** Grupos distintos no payload (Central RN04). */
  count: number;
  /**
   * rsvp: por grupo { partyId, name, confirmed, declined, at }; billing: [{ kind,
   * paymentId, endDate, amountCents, method, installments, cardLast4, at }];
   * commission: [{ commissionId, amountCents, partnerNames, at }]; os outros:
   * [{ partnerNames }].
   */
  payload: unknown;
  readAt: Date | null;
  updatedAt: Date;
}

export interface PreferenceRow {
  type: CenterNotificationType;
  inApp: boolean;
  /** `always`: a cobrança, sempre por e-mail, sem seletor (decisão 236). */
  email: EmailFrequency | 'always';
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

  /**
   * A central da cerimonialista (Notificações da cerimonialista RN05): sem
   * `app.wedding_id`, os casamentos em que ela colabora e os que indicou, sem
   * os de que é dona; o que cada tipo mostra fica com as policies (RN10).
   */
  listPlanner({
    userId,
    type,
    after,
    limit,
  }: {
    userId: string;
    type: PlannerNotificationType | null;
    after: { updatedAt: Date; id: string } | null;
    limit: number;
  }): Promise<NotificationRow[]>;
  unreadCountPlanner({ userId }: { userId: string }): Promise<number>;
  markAllReadPlanner({ userId, now }: { userId: string; now: Date }): Promise<void>;
  /** A preferência geral da cerimonialista, sem casamento (RN06). */
  generalPreferences({ userId }: { userId: string }): Promise<PreferenceRow[]>;
  saveGeneralEmailPreference({
    userId,
    type,
    email,
  }: {
    userId: string;
    type: PlannerNotificationType;
    email: EmailFrequency;
  }): Promise<PreferenceRow>;
}

export const NOTIFICATION_STORE = Symbol('NotificationStore');
