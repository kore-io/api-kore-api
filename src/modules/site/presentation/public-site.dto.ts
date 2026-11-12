import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PREVIEW_MODES, type PreviewMode } from '../domain/site-preview';

class PublicAppearanceResponse {
  fontPairKey: string;
  primaryColor: string;
  /** #FFFFFF ou #1F1F1F, escolhido pelo servidor (Aparência RN09). */
  primaryForeground: string;
  accentColor: string;
  backgroundMode: string;
}

class PublicCoverResponse {
  url: string;
  width: number;
  height: number;
}

class PublicPartyResponse {
  name: string;
}

class PublicPreviewModeResponse {
  @ApiProperty({ enum: ['visitor', 'party'] }) as: 'visitor' | 'party';
  /** O site já foi publicado: "Prévia do site." em vez de "O site ainda não foi publicado." (RN06). */
  published: boolean;
  /** A voz da barra pelo papel de quem gerou a prévia: dono → couple, colaborador → planner (RN06). */
  @ApiProperty({ enum: ['couple', 'planner'] }) audience: 'couple' | 'planner';
}

class PublicViewerResponse {
  /** Visitante, grupo identificado (link do convite) ou prévia (Site público RN05). */
  @ApiProperty({ enum: ['visitor', 'party', 'preview'] }) kind: 'visitor' | 'party' | 'preview';
  @ApiProperty({ type: PublicPartyResponse, nullable: true }) party: PublicPartyResponse | null;
  @ApiProperty({ type: PublicPreviewModeResponse, nullable: true })
  preview: PublicPreviewModeResponse | null;
}

class PublicPlannerCreditResponse {
  @ApiProperty({ example: 'Prado Assessoria' }) name: string;
}

class PublicContactResponse {
  @ApiProperty({ type: String, nullable: true }) whatsapp: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
}

class PublicSectionResponse {
  @ApiProperty({ enum: ['story', 'countdown', 'ceremony', 'lodging', 'dress_code', 'faq'] })
  type: string;
  /** O título do menu (RN10); a contagem não tem. */
  @ApiProperty({ type: String, nullable: true, required: false }) title?: string | null;
  /** Cerimônia para o visitante: o cartão fechado, sem conteúdo (RN05). */
  @ApiProperty({ type: Boolean, required: false }) locked?: boolean;
  /** O conteúdo do tipo, com as imagens prontas no lugar dos ids. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  content?: Record<string, unknown>;
}

export class PublicSiteResponse {
  slug: string;
  /** Os primeiros nomes ("Ana & Marcos"); completos se forem iguais (RN05). */
  names: string;
  @ApiProperty({ type: String, nullable: true, example: '2026-11-14' }) eventDate: string | null;
  city: string;
  state: string;
  timezone: string;
  @ApiProperty({ type: PublicAppearanceResponse }) appearance: PublicAppearanceResponse;
  @ApiProperty({ type: PublicCoverResponse, nullable: true }) cover: PublicCoverResponse | null;
  @ApiProperty({ type: PublicViewerResponse }) viewer: PublicViewerResponse;
  /** Só para o grupo identificado (RN05 e RN10); nulo para o visitante. */
  @ApiProperty({ type: PublicContactResponse, nullable: true })
  contact: PublicContactResponse | null;
  /** Só as ligadas e com conteúdo, na ordem fixa. */
  @ApiProperty({ type: [PublicSectionResponse] }) sections: PublicSectionResponse[];
  /** "Assessoria: {name}" no rodapé, sem link (Assinatura RN01 a RN03); nulo sem assinatura. */
  @ApiProperty({ type: PublicPlannerCreditResponse, nullable: true })
  plannerCredit: PublicPlannerCreditResponse | null;
}

class LinkPreviewImageResponse {
  url: string;
  width: number;
  height: number;
}

export class SiteLinkPreviewResponse {
  /** `generic`: rascunho ou endereço que não existe, sem diferenciar (RN09). */
  @ApiProperty({ enum: ['published', 'generic'] }) state: 'published' | 'generic';
  @ApiProperty({ type: String, nullable: true }) title: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  /** A og.jpg da capa (1200 × 630); nula sem capa. */
  @ApiProperty({ type: LinkPreviewImageResponse, nullable: true })
  image: LinkPreviewImageResponse | null;
}

/** O token do link do grupo: 22 caracteres base64url (Grupos RN11). */
export class PartySessionBody {
  @ApiProperty({ example: 'q3Xv8LmN2pRtY7wK1cZb4A' })
  @Matches(/^[A-Za-z0-9_-]{22}$/)
  token: string;
}

class PartySessionPartyResponse {
  name: string;
}

export class PartySessionResponse {
  /** O endereço do casamento do token: se for outro, o site vai para ele (RN06). */
  slug: string;
  @ApiProperty({ type: PartySessionPartyResponse }) party: PartySessionPartyResponse;
}

/** O modo da prévia: visitante ou um grupo (Pré-visualização RN02 e RN06). */
export class PreviewModeBody {
  @ApiProperty({ enum: PREVIEW_MODES }) @IsIn(PREVIEW_MODES) mode: PreviewMode;

  /** Obrigatório só no modo party. */
  @ApiProperty({ type: String, format: 'uuid', required: false })
  @ValidateIf((body: PreviewModeBody) => body.mode === 'party')
  @IsUUID()
  partyId?: string;
}

export class SitePreviewResponse {
  /** `<SITE_URL>/<slug>?previa=<token>`, para a aba aberta no clique (RN01). */
  url: string;
  @ApiProperty({ format: 'date-time' }) expiresAt: string;
}

/** O token da prévia: 22 caracteres base64url (128 bits; RN02). */
export class PreviewSessionBody {
  @ApiProperty({ example: 'q3Xv8LmN2pRtY7wK1cZb4A' })
  @Matches(/^[A-Za-z0-9_-]{22}$/)
  token: string;
}

class PreviewPartyResponse {
  @ApiProperty({ format: 'uuid' }) id: string;
  name: string;
}

export class PreviewSessionResponse {
  slug: string;
  @ApiProperty({ enum: PREVIEW_MODES }) mode: PreviewMode;
  @ApiProperty({ type: PreviewPartyResponse, nullable: true }) party: PreviewPartyResponse | null;
}

export class PreviewModeResponse {
  @ApiProperty({ enum: PREVIEW_MODES }) mode: PreviewMode;
  @ApiProperty({ type: PreviewPartyResponse, nullable: true }) party: PreviewPartyResponse | null;
}

export class PreviewPartiesQuery {
  /** Busca pelo nome, sem acento e sem diferenciar maiúsculas (decisão 186(2)). */
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(80) q?: string;
}

export class PreviewPartiesResponse {
  /** Quantos grupos batem com a busca, para "Mostrando 100 de {total} grupos." (decisão 203). */
  total: number;
  @ApiProperty({ type: [PreviewPartyResponse] }) data: PreviewPartyResponse[];
}
