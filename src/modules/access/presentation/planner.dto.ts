import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { UpdateSiteAppearanceBody } from '../../site/presentation/site-appearance.dto';
import type { CreatedPlannerWedding } from '../application/create-planner-wedding.use-case';
import type { PlannerProfileView } from '../application/planner-profile.use-cases';
import {
  BRAZILIAN_STATES,
  SLUG_MAX_LENGTH,
  SLUG_MIN_LENGTH,
  type BrazilianState,
} from '../domain/wedding-signup';
import { DATE_ONLY, lowercaseSlug, SLUG, trim } from './weddings.dto';

/**
 * O DTO só confere a forma e põe um teto no tamanho do pedido; as regras dos
 * Dados profissionais (REQUIRED, TOO_LONG, CREDIT_NAME_INVALID, PHONE_INVALID,
 * INVALID, DUPLICATE, TOO_MANY) ficam no domínio (Cadastro e perfil RN04).
 */
const GUARD_LENGTH = 300;
/** Acima do teto de 50 da regra, só para não aceitar uma lista sem fim. */
const GUARD_CITIES = 200;

class PlannerProfileFields {
  /** Nome da assessoria: de 2 a 80, sem link, e-mail nem telefone (RN04). */
  @ApiProperty({ required: false, example: 'Prado Assessoria' })
  // Ausente não muda; null não é ausente: cai no IsString/IsArray (400), não no domínio.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(GUARD_LENGTH)
  creditName?: string;

  /** Seu nome: só quando a conta não tem nome (RN04). */
  @ApiProperty({ required: false, example: 'Juliana Prado' })
  // Ausente não muda; null não é ausente: cai no IsString/IsArray (400), não no domínio.
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(GUARD_LENGTH)
  name?: string;

  /** DDD e número; guardado só com os dígitos. Nulo ou vazio apaga. */
  @ApiProperty({ type: String, required: false, nullable: true, example: '(11) 3333-4444' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(GUARD_LENGTH)
  phone?: string | null;

  @ApiProperty({ type: String, required: false, nullable: true, example: '(11) 99999-8888' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(GUARD_LENGTH)
  whatsapp?: string | null;

  /** "Cidade (UF)", pelo menos 1, até 50, sem repetir. */
  @ApiProperty({ type: [String], required: false, example: ['Campinas (SP)', 'Valinhos (SP)'] })
  // Ausente não muda; null não é ausente: cai no IsString/IsArray (400), não no domínio.
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(GUARD_CITIES)
  @IsString({ each: true })
  @MaxLength(GUARD_LENGTH, { each: true })
  cities?: string[];
}

/** POST /v1/me/planner (RN03 a RN05). */
export class CreatePlannerProfileBody extends PlannerProfileFields {
  /** A versão dos Termos que o app mostrou (RN04). */
  @ApiProperty({ example: '2026-09' }) @IsString() @Length(1, 32) termsVersion: string;
}

/** PATCH /v1/me/planner (RN09 e RN10): todos opcionais. */
export class UpdatePlannerProfileBody extends PlannerProfileFields {
  /** Obrigatório quando os Termos vigentes ainda não foram aceitos (RN10). */
  @ApiProperty({ required: false, example: '2026-09' })
  @IsOptional()
  @IsString()
  @Length(1, 32)
  termsVersion?: string;
}

export class CreatePlannerProfileResponse {
  @ApiProperty({ example: 'juliana-prado' }) referralCode: string;
  @ApiProperty({ example: '/cerimonialista' }) home: string;
}

export class PlannerProfileResponse {
  email: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ example: 'Prado Assessoria' }) creditName: string;
  @ApiProperty({ type: String, nullable: true, example: '1133334444' }) phone: string | null;
  @ApiProperty({ type: String, nullable: true, example: '11999998888' }) whatsapp: string | null;
  @ApiProperty({ type: [String], example: ['Campinas (SP)'] }) cities: string[];
  /** Com cidade, os Termos vigentes e o nome que passa no predicado (RN10). */
  profileComplete: boolean;
  termsAccepted: boolean;
  /** O Admin ocultou a assinatura (Assinatura RN06); o motivo não sai da API. */
  creditHidden: boolean;

  static from({ view }: { view: PlannerProfileView }): PlannerProfileResponse {
    return { ...view };
  }
}

/** GET /v1/me/referrer (Link de indicação RN01 e RN02). */
export class MyReferrerResponse {
  @ApiProperty({ example: 'juliana-prado' }) referralCode: string;
  @ApiProperty({ example: 'https://kore.com.br/i/juliana-prado' }) link: string;
  /** Nulo com o desconto de indicação desligado. Sem o percentual da comissão (D4). */
  @ApiProperty({ type: Number, nullable: true, example: 10 }) discountPercent: number | null;
}

/** POST /v1/me/weddings: o passo 1 e a Aparência do passo 2 (Novo casamento RN02 a RN04). */
export class CreatePlannerWeddingBody {
  /** A pessoa 1 do casal; o título é escolhido no aceite (decisão 172). */
  @ApiProperty({ example: 'Fernanda Alves' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  partner1Name: string;

  @ApiProperty({ example: 'João Lima' })
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  partner2Name: string;

  /** Opcional, com as regras do Cadastro do casal. */
  @ApiProperty({ required: false, example: '2027-03-20' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  eventDate?: string;

  @Transform(trim) @IsString() @Length(1, 80) city: string;
  @ApiProperty({ enum: BRAZILIAN_STATES }) @IsIn(BRAZILIAN_STATES) state: BrazilianState;

  /** Minúsculas, como no Editor (sugestão do Crivo): "Fernanda-E-Joao" vale "fernanda-e-joao". */
  @ApiProperty({ example: 'fernanda-e-joao' })
  @Transform(lowercaseSlug)
  @IsString()
  @Length(SLUG_MIN_LENGTH, SLUG_MAX_LENGTH)
  @Matches(SLUG)
  slug: string;

  /** A Aparência do passo 2 (RN03), com o guarda-corpo do contraste. */
  @ApiProperty({ type: UpdateSiteAppearanceBody, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSiteAppearanceBody)
  appearance?: UpdateSiteAppearanceBody;
}

export class CreatePlannerWeddingResponse {
  weddingId: string;
  slug: string;
  @ApiProperty({ enum: ['draft'] }) status: 'draft';
  timezone: string;

  static from({ wedding }: { wedding: CreatedPlannerWedding }): CreatePlannerWeddingResponse {
    return { ...wedding };
  }
}
