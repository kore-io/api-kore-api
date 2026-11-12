import type { AccessInvitationKind, InvitationWedding } from '../../domain/access-invitation';
import type { MembershipRole } from '../../domain/wedding-authorization';

/** O casamento e quem convida, como o envio e os e-mails precisam ver. */
export interface InvitationWeddingDetails extends InvitationWedding {
  status: string;
  /** Nomes dos noivos 1 e 2, como gravados. */
  partnerNames: [string, string];
  eventDate: Date | null;
  city: string;
  state: string;
}

/** Quem convida, para o nome nos e-mails (Voz & Microcopy, e-mails 2 a 4). */
export interface Inviter {
  /** O nome do noivo, quando quem convida é um dos noivos. */
  partnerName: string | null;
  userName: string | null;
  referrerKind: 'planner' | 'seller' | null;
  /** Nome para a assinatura do cerimonialista (a assessoria). */
  creditName: string | null;
}

export interface PendingInvitation {
  id: string;
  kind: AccessInvitationKind;
  email: string | null;
  expiresAt: Date;
}

export interface NewAccessInvitation {
  id: string;
  weddingId: string;
  kind: AccessInvitationKind;
  email: string | null;
  role: MembershipRole;
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
  /** Só no link do casal sem e-mail: o token cifrado (N1(b), decisão 224). */
  tokenEncrypted: string | null;
}

export interface StoredInvitation {
  id: string;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
}

/** Convites de acesso na transação da requisição, com a RLS ligada. */
export interface AccessInvitationStore {
  /** Serializa os envios do mesmo casamento até o fim da transação (RN04). */
  lockWedding({ weddingId }: { weddingId: string }): Promise<void>;
  loadWedding({ weddingId }: { weddingId: string }): Promise<InvitationWeddingDetails>;
  loadInviter({ weddingId, userId }: { weddingId: string; userId: string }): Promise<Inviter>;
  /** Pendentes no banco: sem aceite, recusa, cancelamento nem substituição (inclui os vencidos). */
  listPending({ weddingId }: { weddingId: string }): Promise<PendingInvitation[]>;
  supersede({ invitationIds, now }: { invitationIds: string[]; now: Date }): Promise<void>;
  insert({ invitations }: { invitations: NewAccessInvitation[] }): Promise<void>;
  /** Rascunho criado pelo indicador vira "aguardando o casal" ao convidar o casal. */
  markAwaitingCouple({ weddingId }: { weddingId: string }): Promise<void>;
  /** Atividade da RN13 (decisão 136): gerar, reenviar ou cancelar convite. */
  touchActivity({ weddingId, now }: { weddingId: string; now: Date }): Promise<void>;
  find({
    weddingId,
    invitationId,
  }: {
    weddingId: string;
    invitationId: string;
  }): Promise<StoredInvitation | null>;
  revoke({ invitationId, now }: { invitationId: string; now: Date }): Promise<void>;
}

export const ACCESS_INVITATION_STORE = Symbol('AccessInvitationStore');
