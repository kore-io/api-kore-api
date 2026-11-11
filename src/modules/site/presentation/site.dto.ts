import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import {
  BRAZILIAN_STATES,
  PARTNER_TITLES,
  type BrazilianState,
  type PartnerTitle,
} from '../../access/domain/wedding-signup';
import { DATE_ONLY, lowercaseSlug } from '../../access/presentation/weddings.dto';
import { SITE_SECTION_TYPES, type SiteSectionType } from '../domain/site-sections';
import type { SiteEditorView } from '../application/site-editor-view';

/** Nomes e cidade: sem espaços sobrando (decisão 166). */
const clean = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
/** Campo de contato apagado no formulário: vazio é o mesmo que null. */
const emptyToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;
const email = ({ value }: { value: unknown }): unknown => {
  const normalized = emptyToNull({ value });
  return typeof normalized === 'string' ? normalized.trim().toLowerCase() : normalized;
};

export class SitePartnerBody {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id: string;
  /** Até 80, obrigatório (RN02 e RN03). */
  @Transform(clean) @IsString() @IsNotEmpty() @MaxLength(80) name: string;
}

/** Todos opcionais; só os enviados mudam (PATCH …/site). */
export class UpdateSiteBody {
  @ApiProperty({ type: [SitePartnerBody], required: false })
  @OptionalNotNull()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => SitePartnerBody)
  partners?: SitePartnerBody[];

  /** `AAAA-MM-DD`, ou null sem data (RN02). */
  @ApiProperty({ type: String, nullable: true, required: false, example: '2026-11-14' })
  @IsOptional()
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  eventDate?: string | null;

  @ApiProperty({ required: false, maxLength: 80 })
  @OptionalNotNull()
  @Transform(clean)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city?: string;

  @ApiProperty({ enum: BRAZILIAN_STATES, required: false })
  @OptionalNotNull()
  @IsIn(BRAZILIAN_STATES)
  state?: BrazilianState;

  /** Em minúsculas antes de validar; o formato e a disponibilidade vêm no caso de uso (RN06). */
  @ApiProperty({ required: false, example: 'ana-e-marcos' })
  @OptionalNotNull()
  @Transform(lowercaseSlug)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  slug?: string;

  /** O parser de telefone da F1; gravado em E.164; null apaga (RN08). */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  contactWhatsapp?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false, maxLength: 254 })
  @IsOptional()
  @Transform(email)
  @IsEmail()
  @MaxLength(254)
  contactEmail?: string | null;

  /** Imagem `ready` deste casamento, ou null para tirar a capa (RN09). */
  @ApiProperty({ type: String, nullable: true, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  coverImageId?: string | null;
}

class SitePartnerResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  name: string;
  @ApiProperty({ enum: PARTNER_TITLES, nullable: true }) title: PartnerTitle | null;
}

export class SiteImageRefResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
}

class SiteAppearanceResponse {
  fontPairKey: string;
  @ApiProperty({ type: String, nullable: true }) starterPaletteKey: string | null;
  primaryColor: string;
  accentColor: string;
  backgroundMode: string;
}

class SiteSectionResponse {
  @ApiProperty({ enum: SITE_SECTION_TYPES }) type: SiteSectionType;
  enabled: boolean;
  /** Ligada e vazia não aparece no site (Seções RN03). */
  empty: boolean;
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  /** O conteúdo do tipo (PUT …/site/sections/{type}), com as imagens no lugar dos ids. */
  @ApiProperty({ type: 'object', additionalProperties: true })
  content: Record<string, unknown>;
}

class SiteEditableResponse {
  names: boolean;
  /** `manage_site_identity` (RN04). */
  eventDate: boolean;
  state: boolean;
  /** Também false depois de publicado (RN05). */
  slug: boolean;
}

export class SiteEditorResponse {
  status: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) publishedAt: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) siteUpdatedAt: string | null;
  @ApiProperty({ type: [SitePartnerResponse] }) partners: SitePartnerResponse[];
  @ApiProperty({ type: String, nullable: true, example: '2026-11-14' }) eventDate: string | null;
  @ApiProperty({ type: String, nullable: true }) city: string | null;
  @ApiProperty({ type: String, nullable: true }) state: string | null;
  @ApiProperty({ type: String, nullable: true }) timezone: string | null;
  /** Nulo quando o casamento ainda não tem endereço (decisão 196). */
  @ApiProperty({ type: String, nullable: true }) slug: string | null;
  @ApiProperty({ type: String, nullable: true }) contactWhatsapp: string | null;
  @ApiProperty({ type: String, nullable: true }) contactEmail: string | null;
  @ApiProperty({ type: SiteImageRefResponse, nullable: true }) cover: SiteImageRefResponse | null;
  @ApiProperty({ type: SiteAppearanceResponse }) appearance: SiteAppearanceResponse;
  @ApiProperty({ type: [SiteSectionResponse] }) sections: SiteSectionResponse[];
  @ApiProperty({ type: SiteEditableResponse }) editable: SiteEditableResponse;

  static from({ view }: { view: SiteEditorView }): SiteEditorResponse {
    return {
      ...view,
      publishedAt: view.publishedAt?.toISOString() ?? null,
      siteUpdatedAt: view.siteUpdatedAt?.toISOString() ?? null,
    };
  }
}
