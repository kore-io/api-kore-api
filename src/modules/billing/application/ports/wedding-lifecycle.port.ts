export type BillingNotice = 'end_date_in_7_days' | 'grace_day_1' | 'grace_day_5' | 'expired';

/** Um aviso de saída do ar devido (Data de saída do ar RN03), com as datas do texto. */
export interface DueNotice {
  weddingId: string;
  notice: BillingNotice;
  /** AAAA-MM-DD. */
  endDate: string;
  graceUntil: string | null;
  expiredAt: string | null;
  eventDate: string | null;
  timezone: string | null;
  /** Dias até a endDate, no fuso do casamento (só no aviso de antes). */
  daysLeft: number;
}

/**
 * O ciclo de vida pela conexão do backoffice (Data de saída do ar RN02 e
 * RN03): o "hoje" é o do fuso de cada casamento (sem fuso, o de Brasília).
 * `weddingId` recorta a rodada a um casamento (o teste; a rotina roda sem ele).
 */
export interface WeddingLifecycleStore {
  /**
   * Numa transação: `published · post_event → grace` (endDate passada, com
   * graceUntil = endDate + 7) e `grace → expired` (graceUntil passado, com
   * expiredAt = graceUntil + 1 e purgeAt = expiredAt + 6 meses), com os logs
   * `wedding.grace` e `wedding.expired` só das linhas mudadas. O relógio corre
   * também no bloqueado e na exclusão agendada (B4-5).
   */
  advance(input: {
    now: Date;
    weddingId?: string;
  }): Promise<{ grace: string[]; expired: string[] }>;
  /**
   * Os avisos devidos pela janela (B4-2) e ainda não enviados para a mesma
   * endDate; sem o casamento bloqueado ou com exclusão agendada (decisão 89).
   */
  dueNotices(input: { now: Date; limit: number; weddingId?: string }): Promise<DueNotice[]>;
}

export const WEDDING_LIFECYCLE_STORE = Symbol('WeddingLifecycleStore');
