import type { SupportEndReason, SupportSessionRecord } from '../../domain/support-session';

/**
 * As sessões de suporte (Backoffice - acesso RN08), pela conexão do
 * backoffice: a support_sessions não tem GRANT ao kore_app (G3).
 */
export interface SupportSessionStore {
  find(input: { id: string }): Promise<SupportSessionRecord | null>;
  /** O casamento tem pessoa dona ativa (sem dono, o Ver como o casal fica desabilitado). */
  hasActiveOwner(input: { weddingId: string }): Promise<boolean | null>;
  /**
   * Abre a sessão de suporte e aponta a sessão do staff para ela; uma aberta
   * antes nesta sessão termina com `exit`. Logs `support_session.started`.
   */
  start(input: {
    sessionId: string;
    adminUserId: string;
    weddingId: string;
    reason: string;
    now: Date;
  }): Promise<SupportSessionRecord>;
  /** Encerra (endedAt, endReason), solta a sessão do staff e grava `support_session.ended`. */
  end(input: { id: string; reason: SupportEndReason; now: Date }): Promise<boolean>;
  /** O logout do staff encerra a sessão de suporte aberta (motivo `logout`). */
  endForSession(input: { sessionId: string; now: Date }): Promise<void>;
  /** Uma requisição da sessão: lastSeenAt e a linha do log, sem conteúdo (B9-5). */
  touch(input: {
    id: string;
    adminUserId: string;
    weddingId: string;
    method: string;
    route: string;
    now: Date;
  }): Promise<void>;
  /** "Ana & Marcos" para a faixa (o GET /v1/me). */
  coupleNames(input: { weddingId: string }): Promise<string>;
}

export const SUPPORT_SESSION_STORE = Symbol('SupportSessionStore');
