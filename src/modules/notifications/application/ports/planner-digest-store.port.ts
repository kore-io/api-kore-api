import type { EmailFrequency } from './notification-store.port';

/** Um casamento da cerimonialista com novidade desde o último e-mail. */
export interface PlannerDigestWedding {
  weddingId: string;
  partnerNames: [string, string];
  emailedThrough: Date | null;
  /** Os payloads das respostas, só com o vínculo de colaboradora ativo (D18). */
  rsvpPayloads: unknown[];
  /** Quando o aviso de publicação chegou, se ela ainda colabora ou indicou (D18). */
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
  /** O novo `emailedThrough` de cada casamento que entrou no e-mail. */
  cursors: { weddingId: string; emailedThrough: Date }[];
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
