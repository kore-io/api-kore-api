/**
 * Token opaco da sessão: o aberto vai no cookie; no banco fica só o hash
 * (ADR de login sem senha).
 */
export interface SessionTokens {
  generate(): { token: string; tokenHash: string };
  hash({ token }: { token: string }): string;
}

export const SESSION_TOKENS = Symbol('SessionTokens');
