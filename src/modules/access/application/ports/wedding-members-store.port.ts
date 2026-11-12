import type { AccessInvitationKind } from '../../domain/access-invitation';
import type { MembershipRole } from '../../domain/wedding-authorization';

export interface WeddingMember {
  id: string;
  userId: string;
  name: string | null;
  role: MembershipRole;
  /** Só no colaborador: cerimonialista ou vendedor, pelo perfil de indicador. */
  kind?: 'planner' | 'seller';
}

export interface PendingAccessInvitation {
  id: string;
  email: string | null;
  kind: AccessInvitationKind;
  expiresAt: Date;
}

/** Colaboradores do casamento, na transação da requisição (RLS por vínculo). */
export interface WeddingMembersStore {
  listActive({ weddingId }: { weddingId: string }): Promise<WeddingMember[]>;
  /** Pendentes no banco, inclusive os vencidos e o link sem e-mail (decisão 177, item 8). */
  listPendingInvitations({ weddingId }: { weddingId: string }): Promise<PendingAccessInvitation[]>;
  lockWedding({ weddingId }: { weddingId: string }): Promise<void>;
  remove({
    membershipId,
    removedByUserId,
    now,
  }: {
    membershipId: string;
    removedByUserId: string;
    now: Date;
  }): Promise<void>;
  /** Dono que saiu: o noivo dele perde o login (decisão 177, item 10). */
  releasePartnerLogin({ weddingId }: { weddingId: string }): Promise<void>;
  /**
   * O aviso membership_removed à cerimonialista que o dono removeu
   * (Notificações da cerimonialista RN04), na transação da remoção. A função
   * do banco ignora o colaborador sem Planner (o vendedor).
   */
  notifyRemoved({
    membershipId,
    notificationId,
  }: {
    membershipId: string;
    notificationId: string;
  }): Promise<void>;
}

export const WEDDING_MEMBERS_STORE = Symbol('WeddingMembersStore');
