import type { CollaborationRow, DeliveryCounts } from '../../domain/my-weddings';

/** Convite do casal pendente de um casamento (Meus casamentos RN08 e RN09). */
export interface PendingCoupleInvitation {
  id: string;
  email: string | null;
  invitedByUserId: string;
  createdAt: Date;
  expiresAt: Date;
  /** Só no link sem e-mail (N1(b)); nunca vai a log. */
  tokenEncrypted: string | null;
}

export interface CollaborationDetail extends CollaborationRow {
  slug: string | null;
  hasOwner: boolean;
  pendingCoupleInvitations: PendingCoupleInvitation[];
}

/**
 * As leituras da Área do cerimonialista na transação da requisição, com o
 * kore_app, `app.user_id` e sem `app.wedding_id` (Meus casamentos RN01;
 * revisão C2-2): a RLS por vínculo já devolve só os casamentos dela, e o
 * leitor filtra o papel `collaborator`. Nunca pela conexão do backoffice.
 */
export interface PlannerWeddingsReader {
  listCollaborations({ userId }: { userId: string }): Promise<CollaborationRow[]>;
  /** Grupos ativos e não enviados, só dos casamentos candidatos (RN06). */
  deliveryCounts({ weddingIds }: { weddingIds: string[] }): Promise<Map<string, DeliveryCounts>>;
  /**
   * Os casamentos com a publicação aguardando pagamento (Comissões RN08;
   * Publicar e pagar RN06), pela `wedding_awaiting_payment`: só o booleano.
   */
  awaitingPayment({ weddingIds }: { weddingIds: string[] }): Promise<Set<string>>;
  collaboration({
    userId,
    weddingId,
  }: {
    userId: string;
    weddingId: string;
  }): Promise<CollaborationDetail | null>;
}

export const PLANNER_WEDDINGS_READER = Symbol('PlannerWeddingsReader');
