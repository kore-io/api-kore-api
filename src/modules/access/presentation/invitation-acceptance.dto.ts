import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { AcceptedInvitation } from '../application/accept-access-invitation.use-case';
import type { AccessInvitationView } from '../application/get-access-invitation.use-case';
import { ACCESS_INVITATION_KINDS, type AccessInvitationKind } from '../domain/access-invitation';
import { PARTNER_TITLES, type PartnerTitle } from '../domain/wedding-signup';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

class InvitedByResponse {
  name: string;
  @ApiProperty({ enum: ['owner', 'planner', 'seller'] }) role: 'owner' | 'planner' | 'seller';
}

class InvitationWeddingResponse {
  @ApiProperty({ example: 'Ana & Marcos' }) names: string;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-14' }) eventDate: string | null;
  city: string;
  state: string;
  /** Todo convite do casal, para "Quem é você?" (decisão 173). */
  @ApiProperty({ type: [String], required: false }) partnerNames?: [string, string];
  /** Só no do parceiro: a tela pergunta noivo ou noiva (decisão 173). */
  @ApiProperty({ required: false }) partnerTitleNeeded?: boolean;
}

class InvitationReferrerResponse {
  name: string;
  @ApiProperty({ type: Number, nullable: true }) discountPercent: number | null;
}

export class AccessInvitationResponse {
  @ApiProperty({ enum: ACCESS_INVITATION_KINDS }) kind: AccessInvitationKind;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  invitedBy: InvitedByResponse;
  wedding: InvitationWeddingResponse;
  /** Só no do casal; nulo até a fase da Aparência (decisão 168). */
  @ApiProperty({ type: Object, nullable: true, required: false }) sitePreview?: null;
  /** Só no do casal. */
  @ApiProperty({ type: InvitationReferrerResponse, nullable: true, required: false })
  referrer?: InvitationReferrerResponse | null;
  sessionEmailMismatch: boolean;
  /** Do cerimonialista, com sessão de conta sem nome: o aceite pede o nome (decisão 173). */
  needsName: boolean;

  static from({ view }: { view: AccessInvitationView }): AccessInvitationResponse {
    return {
      ...view,
      wedding: {
        ...view.wedding,
        eventDate: view.wedding.eventDate?.toISOString().slice(0, 10) ?? null,
      },
    };
  }
}

export class AcceptAccessInvitationBody {
  /** A pessoa confirmou a tela Outra conta (RN07). */
  @IsOptional() @IsBoolean() confirmOtherAccount?: boolean;

  /** "Quem é você?" no convite do casal (RN14; decisão 172): 1 ou 2. */
  @ApiProperty({ enum: [1, 2], required: false })
  @IsOptional()
  @IsIn([1, 2])
  partnerIndex?: 1 | 2;

  /** No do casal, e no do parceiro quando o noivo ainda não tem título (decisão 172). */
  @ApiProperty({ enum: PARTNER_TITLES, required: false })
  @IsOptional()
  @IsIn(PARTNER_TITLES)
  myTitle?: PartnerTitle;

  /** Só no do cerimonialista, quando a conta ainda não tem nome (decisão 168). */
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) name?: string;
}

export class AcceptAccessInvitationResponse {
  weddingId: string;
  @ApiProperty({ enum: ['owner', 'collaborator'] }) role: 'owner' | 'collaborator';
  weddingStatus: string;
  attributedToMe: boolean;

  static from({ accepted }: { accepted: AcceptedInvitation }): AcceptAccessInvitationResponse {
    return { ...accepted };
  }
}
