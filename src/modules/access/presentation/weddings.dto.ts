import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import type { CreatedWedding } from '../application/create-wedding.use-case';
import type { SlugAvailability } from '../application/check-slug-availability.use-case';
import {
  BRAZILIAN_STATES,
  CLIENT_SIGNUP_SOURCES,
  PARTNER_TITLES,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  type BrazilianState,
  type ClientSignupSource,
  type PartnerTitle,
} from '../domain/wedding-signup';

/** Data do casamento, só o dia (YYYY-MM-DD) e existente no calendário. */
export const DATE_ONLY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

/** RN04: 3 a 40 caracteres, a-z, 0-9 e hífen, sem hífen no começo, no fim ou repetido. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateWeddingBody {
  @Transform(trim) @IsString() @Length(1, 80) myName: string;
  @ApiProperty({ enum: PARTNER_TITLES }) @IsIn(PARTNER_TITLES) myTitle: PartnerTitle;
  @Transform(trim) @IsString() @Length(1, 80) partnerName: string;

  /** Opcional (RN02). */
  @ApiProperty({ required: false, example: '2026-11-14' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  eventDate?: string;

  @Transform(trim) @IsString() @Length(1, 80) city: string;
  @ApiProperty({ enum: BRAZILIAN_STATES }) @IsIn(BRAZILIAN_STATES) state: BrazilianState;

  @ApiProperty({ example: 'ana-e-marcos' })
  @IsString()
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH)
  @Matches(SLUG)
  slug: string;

  /** O link de indicação guardado no aparelho (RN08). */
  @IsOptional() @IsString() @MaxLength(200) referralCode?: string;

  /** A versão dos Termos que o app mostrou (RN11). */
  @ApiProperty({ example: '2026-09' }) @IsString() @Length(1, 32) termsVersion: string;

  /** Origem do cadastro; padrão direct (decisões 135 e 166). */
  @ApiProperty({ enum: CLIENT_SIGNUP_SOURCES, required: false })
  @IsOptional()
  @IsIn(CLIENT_SIGNUP_SOURCES)
  signupSource?: ClientSignupSource;

  @IsOptional() @IsString() @MaxLength(200) utmSource?: string;
  @IsOptional() @IsString() @MaxLength(200) utmMedium?: string;
  @IsOptional() @IsString() @MaxLength(200) utmCampaign?: string;
}

class CreatedWeddingReferrer {
  name: string;
  @ApiProperty({ type: Number, nullable: true }) discountPercent: number | null;
}

export class CreateWeddingResponse {
  weddingId: string;
  slug: string;
  @ApiProperty({ enum: ['draft'] }) status: 'draft';
  timezone: string;
  /** Nulo sem indicação atribuída (RN08). */
  @ApiProperty({ type: CreatedWeddingReferrer, nullable: true })
  referrer: CreatedWeddingReferrer | null;

  static from({ wedding }: { wedding: CreatedWedding }): CreateWeddingResponse {
    return { ...wedding };
  }
}

export class SlugAvailabilityQuery {
  @IsString() @MaxLength(200) slug: string;

  /** Para a sugestão com o ano (RN05). */
  @ApiProperty({ required: false, example: '2026-11-14' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  eventDate?: string;
}

export class SlugAvailabilityResponse {
  slug: string;
  available: boolean;
  @ApiProperty({ enum: ['taken', 'reserved', 'invalid_format'], nullable: true })
  reason: SlugAvailability['reason'];
  @ApiProperty({ type: String, nullable: true }) suggestion: string | null;

  static from({ availability }: { availability: SlugAvailability }): SlugAvailabilityResponse {
    return { ...availability };
  }
}
