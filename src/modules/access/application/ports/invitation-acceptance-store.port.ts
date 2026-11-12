import type { InvitationSnapshot } from '../../domain/invitation-acceptance';
import type { PartnerTitle } from '../../domain/wedding-signup';

export type AcceptRefusal =
  'not_pending' | 'owners_full' | 'partner_taken' | 'planner_already' | 'self_referral';

/**
 * Aceite e recusa pelo token (decisão 172): a pessoa ainda não tem vínculo, então
 * a leitura e a gravação passam pelas funções do banco que agem pelo hash.
 */
export interface InvitationAcceptanceStore {
  findByToken({ tokenHash }: { tokenHash: string }): Promise<InvitationSnapshot | null>;
  /** Vínculo ativo da pessoa neste casamento, se houver (decisão 172, item 3). */
  activeRole({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<'owner' | 'collaborator' | null>;
  lockWedding({ weddingId }: { weddingId: string }): Promise<void>;
  accept({
    tokenHash,
    membershipId,
    partnerSlot,
    partnerTitle,
    acceptedForEmail,
  }: {
    tokenHash: string;
    membershipId: string;
    partnerSlot: 1 | 2 | null;
    partnerTitle: PartnerTitle | null;
    acceptedForEmail: string | null;
  }): Promise<{ weddingId: string; attributed: boolean } | AcceptRefusal>;
  /**
   * RN09, primeiro aceite do casal: "aguardando o casal" vira rascunho, e o
   * vendedor que criou sai do casamento (decisão 172, item 5).
   */
  handOverToCouple({
    weddingId,
    sellerUserId,
    now,
  }: {
    weddingId: string;
    sellerUserId: string | null;
    now: Date;
  }): Promise<string>;
  /** RN11: só convite por e-mail, pendente e no prazo; false se nada mudou. */
  decline({ tokenHash }: { tokenHash: string }): Promise<boolean>;
}

export const INVITATION_ACCEPTANCE_STORE = Symbol('InvitationAcceptanceStore');
