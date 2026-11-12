export interface PartyCookieClaims {
  partyId: string;
  linkVersion: number;
}

/**
 * O cookie assinado do grupo, um por casamento: `kore_party_<weddingId>`
 * (Site público RN06 e RN08; ADR-36). Não guarda nada no banco.
 */
export interface PartyCookies {
  name({ weddingId }: { weddingId: string }): string;
  sign({ weddingId, claims }: { weddingId: string; claims: PartyCookieClaims }): string;
  /** Null com assinatura errada, de outro casamento ou fora do formato. */
  verify({ weddingId, value }: { weddingId: string; value: string }): PartyCookieClaims | null;
}

export const PARTY_COOKIES = Symbol('PartyCookies');
