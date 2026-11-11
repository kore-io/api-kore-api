/** O link do grupo (Grupos RN11; ADR do cookie do grupo; decisão 196). */
export interface PartyLinks {
  /** Token novo de 128 bits. */
  newToken(): string;
  /** <SITE_URL>/<slug>/grupo/<token>; null quando o casamento ainda não tem slug. */
  url({ slug, token }: { slug: string | null; token: string }): string | null;
}

export const PARTY_LINKS = Symbol('PartyLinks');
