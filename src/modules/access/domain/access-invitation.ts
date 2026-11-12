import type { MembershipRole } from './wedding-authorization';

/** Os três tipos de convite de acesso (RN01 de Convites). */
export const ACCESS_INVITATION_KINDS = ['partner', 'couple', 'planner'] as const;
export type AccessInvitationKind = (typeof ACCESS_INVITATION_KINDS)[number];

/** RN03: o convite vale 30 dias. */
export const INVITATION_VALIDITY_DAYS = 30;

export function invitationExpiresAt({ now }: { now: Date }): Date {
  return new Date(now.getTime() + INVITATION_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
}

/** RN01: parceiro e casal viram donos; o cerimonialista, colaborador. */
export function roleGrantedBy({ kind }: { kind: AccessInvitationKind }): MembershipRole {
  return kind === 'planner' ? 'collaborator' : 'owner';
}

/** Para quem vai o convite: um e-mail; no do casal, até dois, ou nenhum (link, RN14). */
export function recipientsAllowed({
  kind,
  emails,
}: {
  kind: AccessInvitationKind;
  emails: readonly string[];
}): boolean {
  if (new Set(emails.map((email) => email.toLowerCase())).size !== emails.length) return false;
  if (kind === 'couple') return emails.length <= 2;
  return emails.length === 1;
}

/** O casamento, como o envio precisa ver (RN02). */
export interface InvitationWedding {
  createdByUserId: string;
  /** Criado pelo indicador para o casal (created_by_planner ou created_by_seller). */
  createdByReferrer: boolean;
  activeOwners: number;
  activeCollaborators: number;
}

export type SendRefusal = 'action_not_allowed' | 'owners_full' | 'planner_already';

/**
 * RN02: o do parceiro, um dono, enquanto há menos de 2 donos; o do
 * cerimonialista, um dono, enquanto não há cerimonialista (na F0, todo
 * colaborador de um casamento com dono é o cerimonialista: o vendedor sai no
 * aceite do casal); o do casal, o indicador que criou o casamento, enquanto o
 * casal não aceitou.
 */
export function sendRefusal({
  kind,
  senderId,
  senderRole,
  wedding,
}: {
  kind: AccessInvitationKind;
  senderId: string;
  senderRole: MembershipRole;
  wedding: InvitationWedding;
}): SendRefusal | null {
  if (kind === 'couple') {
    const isCreatorReferrer = wedding.createdByReferrer && wedding.createdByUserId === senderId;
    return isCreatorReferrer && wedding.activeOwners === 0 ? null : 'action_not_allowed';
  }
  if (senderRole !== 'owner') return 'action_not_allowed';
  if (kind === 'partner' && wedding.activeOwners >= 2) return 'owners_full';
  if (kind === 'planner' && wedding.activeCollaborators > 0) return 'planner_already';
  return null;
}

/** Até 2 convites do casal por e-mail pendentes por casamento (Modelo de Dados; decisão 170). */
export const MAX_PENDING_COUPLE_EMAIL_INVITATIONS = 2;

/**
 * Decisão 170(4): contam os convites do casal por e-mail ainda pendentes e não
 * vencidos que o envio não substitui, mais os novos; o link sem e-mail não conta.
 */
export function coupleInvitationsFull({
  remainingActive,
  adding,
}: {
  remainingActive: number;
  adding: number;
}): boolean {
  return remainingActive + adding > MAX_PENDING_COUPLE_EMAIL_INVITATIONS;
}

/** RN05: quem enviou, ou um dono, cancela. */
export function canCancel({
  invitedByUserId,
  userId,
  role,
}: {
  invitedByUserId: string;
  userId: string;
  role: MembershipRole;
}): boolean {
  return role === 'owner' || invitedByUserId === userId;
}

/** Pendente (RN04 e RN05): sem aceite, recusa, cancelamento, substituição, e no prazo. */
export function isPendingAt({
  invitation,
  now,
}: {
  invitation: {
    acceptedAt: Date | null;
    declinedAt: Date | null;
    revokedAt: Date | null;
    supersededAt: Date | null;
    expiresAt: Date;
  };
  now: Date;
}): boolean {
  return (
    !invitation.acceptedAt &&
    !invitation.declinedAt &&
    !invitation.revokedAt &&
    !invitation.supersededAt &&
    invitation.expiresAt > now
  );
}

/** Primeiro nome, para os e-mails e a tela (Voz & Microcopy: só o primeiro nome). */
export function firstName({ name }: { name: string }): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
