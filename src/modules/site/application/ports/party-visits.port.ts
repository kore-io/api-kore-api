/**
 * Convite visualizado (RSVP RN02; decisão 216, D12): só a troca do token por
 * POST grava, pela transação do grupo.
 */
export interface PartyVisits {
  /**
   * Num site publicado: firstViewedAt só se nulo e o status de envio `viewed`
   * a partir de `not_sent` ou `sent`. Fora do ar, ou se o grupo deixou de valer
   * entre a leitura e a escrita, não grava nada.
   */
  markViewed({
    weddingId,
    partyId,
    linkVersion,
  }: {
    weddingId: string;
    partyId: string;
    linkVersion: number;
  }): Promise<void>;
}

export const PARTY_VISITS = Symbol('PartyVisits');
