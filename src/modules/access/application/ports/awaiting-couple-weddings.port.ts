/**
 * Os casamentos "aguardando o casal" pela conexão do backoffice (decisão 297):
 * a rotina diária acha os que ficaram sem convite de dono pendente (o link
 * venceu) e os volta a rascunho.
 */
export interface AwaitingCoupleWeddings {
  /** Os ids dos `awaiting_couple` sem convite de dono pendente e no prazo em `now`. */
  listWithoutPendingInvitation(input: { now: Date; weddingId?: string }): Promise<string[]>;
  /** Volta a rascunho, com o log `wedding.awaiting_couple_reverted` (system); false se nada mudou. */
  revert(input: { weddingId: string; now: Date }): Promise<boolean>;
}

export const AWAITING_COUPLE_WEDDINGS = Symbol('AwaitingCoupleWeddings');
