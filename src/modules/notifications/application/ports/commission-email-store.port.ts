import type { EmailFrequency } from './notification-store.port';

/** O que o e-mail de comissão precisa, travado por pessoa (decisão 242). */
export interface LockedCommissionEmail {
  email: string;
  firstName: string | null;
  /** A preferência geral `commission`; sem linha, o padrão (Resumo diário). */
  frequency: EmailFrequency;
  /** A notificação `commission` mais nova ainda não avisada por e-mail; nula sem nenhuma. */
  newestPendingAt: Date | null;
}

/**
 * O e-mail "Você tem comissão disponível" (Comissões do indicador RN09;
 * decisão 242), pelo worker (backoffice): o cursor
 * `NotificationDigestState.commissionEmailedThrough`, gravado na mesma
 * transação que marca o envio.
 */
export interface CommissionEmailStore {
  /** Quem tem comissão disponível ainda não avisada e a preferência em Resumo diário. */
  dailyCandidates(): Promise<string[]>;
  /** `work` devolve o novo cursor, ou nulo quando não mandou. */
  withLockedState({
    userId,
    work,
  }: {
    userId: string;
    work: (state: LockedCommissionEmail) => Promise<Date | null>;
  }): Promise<void>;
}

export const COMMISSION_EMAIL_STORE = Symbol('CommissionEmailStore');
