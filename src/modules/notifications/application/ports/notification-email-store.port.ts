import type { EmailFrequency } from './notification-store.port';

/** O estado do e-mail de uma pessoa num casamento, travado para o envio (E-mail e push RN02). */
export interface LockedEmailState {
  /** O vínculo ativo: perder o vínculo para os envios (RN09; D18). */
  member: boolean;
  /**
   * Quem recebe, conferido na hora de mandar: o dono (os textos e a
   * preferência do casamento) ou a cerimonialista colaboradora com Planner
   * (os textos dela e a preferência geral; Notificações da cerimonialista RN06
   * e RN07). Nulo sem vínculo.
   */
  role: 'owner' | 'planner' | null;
  /** Os primeiros nomes do casal, para os textos da cerimonialista. */
  partnerNames: [string, string];
  email: string;
  firstName: string | null;
  /**
   * A preferência do tipo `rsvp`: a do casamento para o dono, a geral para a
   * cerimonialista; sem linha, o padrão (Resumo diário).
   */
  frequency: EmailFrequency;
  timezone: string;
  emailedThrough: Date | null;
  lastImmediateAt: Date | null;
  /** AAAA-MM-DD, no fuso do casamento. */
  lastDigestDate: string | null;
  /** Os payloads das notificações da pessoa neste casamento, mais novos que o cursor. */
  payloads: unknown[];
  totals: { confirmed: number; declined: number; pending: number };
}

export interface EmailStateChange {
  emailedThrough?: Date;
  lastImmediateAt?: Date;
  lastDigestDate?: string;
}

/** Um par pessoa e casamento com resposta que ainda não foi por e-mail. */
export interface EmailCandidate {
  userId: string;
  weddingId: string;
}

/** O estado do e-mail, só pelo worker (backoffice; RN02). */
export interface NotificationEmailStore {
  /**
   * Numa transação: cria a linha do estado se faltar, trava (FOR UPDATE), lê o
   * que o envio precisa e grava a mudança que o trabalho devolver. Se o
   * trabalho falhar (o envio não foi aceito), nada muda (o cursor não avança).
   */
  withLockedState({
    userId,
    weddingId,
    work,
  }: {
    userId: string;
    weddingId: string;
    work: (state: LockedEmailState) => Promise<EmailStateChange | null>;
  }): Promise<void>;
  /** A preferência (pelo papel) e o último "Na hora", sem travar (para agendar o envio). */
  peek({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<{ frequency: EmailFrequency; lastImmediateAt: Date | null }>;
  /**
   * Os pares com notificação atualizada depois do cursor (a rotina de 15
   * minutos); `weddingId` recorta a rodada (o teste).
   */
  candidates(input?: { weddingId?: string }): Promise<EmailCandidate[]>;
  /**
   * RN04 ("Sem novidade, sem resumo"; decisão 246): grava o `lastDigestDate`
   * de hoje para os donos em Resumo diário dos casamentos que já passaram das
   * 20h, mesmo sem novidade, para uma resposta das 22h ficar para o resumo do
   * dia seguinte. `skip`: os pares cujo envio falhou nesta rodada.
   */
  closeQuietDigests(input: {
    now: Date;
    skip: readonly EmailCandidate[];
    weddingId?: string;
  }): Promise<number>;
}

export const NOTIFICATION_EMAIL_STORE = Symbol('NotificationEmailStore');
