import { ApiProperty } from '@nestjs/swagger';
import type {
  PendingAccessInvitation,
  WeddingMember,
} from '../application/ports/wedding-members-store.port';
import { ACCESS_INVITATION_KINDS, type AccessInvitationKind } from '../domain/access-invitation';

class WeddingMemberResponse {
  id: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: ['owner', 'collaborator'] }) role: 'owner' | 'collaborator';
  /** Só no colaborador (decisão 177, item 8). */
  @ApiProperty({ enum: ['planner', 'seller'], required: false }) kind?: 'planner' | 'seller';
  /** O vínculo de quem lê (decisão 261(2)). */
  isMe: boolean;
}

class PendingInvitationResponse {
  id: string;
  /** Nulo no link do casal sem e-mail (decisão 177, item 8). */
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ enum: ACCESS_INVITATION_KINDS }) kind: AccessInvitationKind;
  /** Vencido continua pendente até o reenvio; o app mostra "venceu". */
  expiresAt: string;
}

/** GET /v1/weddings/{weddingId}/memberships. */
export class WeddingMembersResponse {
  @ApiProperty({ type: [WeddingMemberResponse] }) members: WeddingMemberResponse[];
  @ApiProperty({ type: [PendingInvitationResponse] })
  pendingInvitations: PendingInvitationResponse[];

  static from({
    members,
    pendingInvitations,
    viewerUserId,
  }: {
    members: WeddingMember[];
    pendingInvitations: PendingAccessInvitation[];
    viewerUserId: string;
  }): WeddingMembersResponse {
    return {
      members: members.map(({ id, userId, name, role, kind }) => ({
        id,
        name,
        role,
        ...(kind ? { kind } : {}),
        isMe: userId === viewerUserId,
      })),
      pendingInvitations: pendingInvitations.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }
}
