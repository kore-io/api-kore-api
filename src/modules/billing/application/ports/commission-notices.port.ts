/**
 * Os avisos da comissão disponível (Comissões do indicador RN09; decisão 242),
 * depois do commit da liberação: o push de cada comissão e o e-mail "Na hora"
 * de cada pessoa (um por rodada). O worker confere a preferência e os aparelhos.
 */
export interface CommissionNotices {
  released(input: { items: readonly { userId: string; weddingId: string }[] }): Promise<void>;
}

export const COMMISSION_NOTICES = Symbol('CommissionNotices');
