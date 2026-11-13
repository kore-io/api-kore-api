import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { Me } from '../application/get-me.use-case';
import type { PlatformRole, ProfileKind } from '../domain/authenticated-session';
import { PROFILE_KINDS } from '../domain/profiles';

class MeUserResponse {
  id: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  email: string;
  @ApiProperty({ enum: ['none', 'admin', 'support'] }) platformRole: PlatformRole;
}

class MeLifecycleResponse {
  @ApiProperty({
    enum: ['awaiting_couple', 'draft', 'published', 'post_event', 'grace', 'expired'],
  })
  status: string;
  /** Bloqueado pelo suporte (Casamento bloqueado RN07): a faixa substitui as outras. */
  blocked: boolean;
  /** A data de saída do ar (último dia pago). */
  @ApiProperty({ type: String, nullable: true, example: '2027-02-14' }) endDate: string | null;
  /** O último dia no ar na carência; o selo "Vence em N dias" conta até o expiredAt. */
  @ApiProperty({ type: String, nullable: true, example: '2027-02-21' }) graceUntil: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2027-02-22' }) expiredAt: string | null;
  @ApiProperty({ type: String, nullable: true }) deletionScheduledFor: string | null;
}

class MeMembershipResponse {
  weddingId: string;
  @ApiProperty({ enum: ['owner', 'collaborator'] }) role: 'owner' | 'collaborator';
  /** "Ana & Marcos" (decisão 163). */
  weddingName: string;
  @ApiProperty({ type: String, nullable: true, example: '2027-03-20' }) eventDate: string | null;
  city: string;
  state: string;
  /** As faixas e o selo da Topbar (Data de saída do ar RN06; decisão 231). */
  @ApiProperty({ type: MeLifecycleResponse }) lifecycle: MeLifecycleResponse;
}

class MePlannerResponse {
  @ApiProperty({ example: 'Prado Assessoria' }) organization: string;
  weddingsCount: number;
}

class MeReferrerResponse {
  @ApiProperty({ enum: ['planner', 'seller'] }) kind: 'planner' | 'seller';
  referralCode: string;
}

/** GET /v1/me (decisões 163, 174 e 177). */
export class MeResponse {
  user: MeUserResponse;
  @ApiProperty({ type: [MeMembershipResponse] }) memberships: MeMembershipResponse[];
  @ApiProperty({ type: MePlannerResponse, nullable: true }) planner: MePlannerResponse | null;
  @ApiProperty({ enum: PROFILE_KINDS, isArray: true }) profiles: ProfileKind[];
  @ApiProperty({ enum: PROFILE_KINDS, nullable: true }) activeProfile: ProfileKind | null;
  @ApiProperty({ enum: PROFILE_KINDS, nullable: true }) lastProfileOnDevice: ProfileKind | null;
  @ApiProperty({ type: MeReferrerResponse, nullable: true }) referrer: MeReferrerResponse | null;
  authenticatedAt: string;
  /** O cadastro próprio de cerimonialista está aberto (Cadastro e perfil RN02). */
  plannerSignupEnabled: boolean;

  static from({ me }: { me: Me }): MeResponse {
    return {
      user: me.user,
      memberships: me.memberships.map((membership) => ({
        ...membership,
        eventDate: membership.eventDate?.toISOString().slice(0, 10) ?? null,
      })),
      planner: me.planner,
      profiles: me.profiles,
      activeProfile: me.activeProfile,
      lastProfileOnDevice: me.lastProfileOnDevice,
      referrer: me.referrer,
      authenticatedAt: me.authenticatedAt.toISOString(),
      plannerSignupEnabled: me.plannerSignupEnabled,
    };
  }
}

export class SetActiveProfileBody {
  @ApiProperty({ enum: PROFILE_KINDS }) @IsIn(PROFILE_KINDS) profile: ProfileKind;
}

export class SetActiveProfileResponse {
  @ApiProperty({ enum: PROFILE_KINDS }) activeProfile: ProfileKind;
  @ApiProperty({ example: '/app' }) home: string;
}
