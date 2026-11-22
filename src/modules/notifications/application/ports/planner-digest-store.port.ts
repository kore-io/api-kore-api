import type { EmailFrequency } from './notification-store.port';

/** Um casamento da cerimonialista com novidade desde o último e-mail. */
export interface PlannerDigestWedding {
  weddingId: string;
  partnerNames: [string, string];
  /** O cursor das respostas, o mesmo do e-mail na hora. */
  emailedThrough: Date | null;
  /** Os payloads das respostas, só com o vínculo de colaboradora ativo (D18). */
  rsvpPayloads: unknown[];
  /**
   * Quando o aviso de publicação chegou, se ela ainda colabora ou indicou (D18)
   * e ele ainda não foi num Resumo (o cursor próprio; decisão 308(5)).
   */
  publishedAt: Date | null;
}

/** O que o Resumo agrupado precisa, travado por pessoa (Notificações da cerimonialista RN07). */
export interface LockedPlannerDigest {
  email: string;
  firstName: string | null;
  /** AAAA-MM-DD em America/Sao_Paulo. */
  lastDigestDate: string | null;
  /** As preferências gerais; sem linha, o padrão (Resumo diário). */
  rsvpFrequency: EmailFrequency;
  publishedFrequency: EmailFrequency;
  weddings: PlannerDigestWedding[];
}

export interface PlannerDigestChange {
  lastDigestDate: string;
  /**
   * Os cursores de cada casamento que entrou no e-mail: o das respostas
   * (`emailedThrough`, só quando foram respostas) e o da publicação
   * (`publishedEmailedThrough`, só quando foi a publicação). Um cursor por
   * tipo: o e-mail na hora de uma resposta não passa por cima da publicação
   * que espera o Resumo (decisão 308(5)).
   */
  cursors: { weddingId: string; emailedThrough?: Date; publishedEmailedThrough?: Date }[];
}

/**
 * O Resumo agrupado, pelo worker (backoffice): o "já mandei hoje" na
 * NotificationDigestState e os cursores na NotificationEmailState, gravados
 * na mesma transação que marca o envio (revisão C8-7).
 */
export interface PlannerDigestStore {
  /** As cerimonialistas com resposta ou publicação que ainda não foi por e-mail. */
  candidates(): Promise<string[]>;
  withLockedDigest({
    userId,
    work,
  }: {
    userId: string;
    work: (state: LockedPlannerDigest) => Promise<PlannerDigestChange | null>;
  }): Promise<void>;
}

export const PLANNER_DIGEST_STORE = Symbol('PlannerDigestStore');
