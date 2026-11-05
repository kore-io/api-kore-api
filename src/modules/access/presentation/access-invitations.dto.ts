import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { SentInvitation } from '../application/send-access-invitations.use-case';
import { ACCESS_INVITATION_KINDS, type AccessInvitationKind } from '../domain/access-invitation';

const normalizeEmails = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((email: unknown) =>
        typeof email === 'string' ? email.trim().toLowerCase() : email,
      )
    : value;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class SendAccessInvitationsBody {
  @ApiProperty({ enum: ACCESS_INVITATION_KINDS })
  @IsIn(ACCESS_INVITATION_KINDS)
  kind: AccessInvitationKind;

  /** Um e-mail; até dois só no do casal; vazio ou omitido só no do casal (link, RN14). */
  @IsOptional()
  @Transform(normalizeEmails)
  @IsArray()
  @ArrayMaxSize(2)
  @IsEmail({}, { each: true })
  @MaxLength(254, { each: true })
  emails?: string[];

  /** Só vai no e-mail (decisão 168). */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  message?: string;
}

class SentInvitationResponse {
  id: string;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ enum: ACCESS_INVITATION_KINDS }) kind: AccessInvitationKind;
  expiresAt: string;
  resent: boolean;
  /** Só no link sem e-mail (RN14). */
  url?: string;
}

export class SendAccessInvitationsResponse {
  @ApiProperty({ type: [SentInvitationResponse] }) invitations: SentInvitationResponse[];

  static from({ invitations }: { invitations: SentInvitation[] }): SendAccessInvitationsResponse {
    return {
      invitations: invitations.map((invitation) => ({
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
      })),
    };
  }
}
