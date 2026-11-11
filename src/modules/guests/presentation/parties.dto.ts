import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { PartyList } from '../application/list-parties.use-case';
import type { PartyView } from '../application/party-view';
import {
  AGE_GROUPS,
  DELIVERY_STATUSES,
  GUEST_NAME_MAX,
  INTERNAL_NOTE_MAX,
  PARTY_NAME_MAX,
  PLUS_ONE_SLOTS_MAX,
  RSVP_STATUSES,
  TAG_COLORS,
  type AgeGroup,
  type DeliveryStatus,
  type RsvpStatus,
  type TagColor,
} from '../domain/party';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';

/** Nome sem espaços nas pontas (RN04). */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Texto opcional: vazio vira ausente. */
const trimOptional = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** E-mail guardado em minúsculas (RN04). */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() || undefined : value;

/** Limite prático do pedido, acima de qualquer grupo real; a importação tem o seu. */
const GUESTS_PER_PARTY_MAX = 100;
/** Tags ativas do casamento: até 10 (Tags RN01). */
const TAGS_MAX = 10;

export class CreatePartyGuestBody {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(GUEST_NAME_MAX) name: string;

  @ApiProperty({ enum: AGE_GROUPS, required: false })
  @IsOptional()
  @IsIn(AGE_GROUPS)
  ageGroup?: AgeGroup;

  /** BR com DDD ou internacional com "+"; validado no servidor (RN04), gravado em E.164. */
  @ApiProperty({ required: false, example: '(19) 99876-1402' })
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional() @Transform(normalizeEmail) @IsEmail() @MaxLength(254) email?: string;
}

export class CreatePartyBody {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PARTY_NAME_MAX) name: string;

  /** Um ou mais, na ordem do grupo (RN03, RN17). */
  @ApiProperty({ type: [CreatePartyGuestBody] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(GUESTS_PER_PARTY_MAX)
  @ValidateNested({ each: true })
  @Type(() => CreatePartyGuestBody)
  guests: CreatePartyGuestBody[];

  /** Posição do contato em guests; omitido, o primeiro com telefone ou e-mail (RN06). */
  @OptionalNotNull() @IsInt() @Min(0) contactIndex?: number;

  /** Vagas de acompanhante (RN07). */
  @ApiProperty({ required: false, minimum: 0, maximum: PLUS_ONE_SLOTS_MAX, default: 0 })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PLUS_ONE_SLOTS_MAX)
  plusOneSlots?: number;

  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX)
  @IsUUID('all', { each: true })
  tagIds?: string[];

  /** "Só vocês veem" (RN03). */
  @IsOptional()
  @Transform(trimOptional)
  @IsString()
  @MaxLength(INTERNAL_NOTE_MAX)
  internalNote?: string;
}

/** No PATCH, texto vazio apaga (vira null); ausente não muda. */
const trimToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

const normalizeEmailToNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() || null : value;

export class UpdatePartyGuestBody {
  /** Com id, edita o convidado com nome deste grupo; sem id, cria um novo (pendente). */
  @OptionalNotNull() @IsUUID() id?: string;

  /** Obrigatório no convidado novo; não aceita null. */
  @ApiProperty({ required: false, type: String })
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GUEST_NAME_MAX)
  name?: string;

  @ApiProperty({ enum: AGE_GROUPS, required: false, nullable: true, type: String })
  @IsOptional()
  @IsIn(AGE_GROUPS)
  ageGroup?: AgeGroup | null;

  /** null ou vazio apaga. */
  @ApiProperty({ required: false, nullable: true, type: String, example: '(19) 99876-1402' })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  /** null ou vazio apaga. */
  @ApiProperty({ required: false, nullable: true, type: String })
  @IsOptional()
  @Transform(normalizeEmailToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  /** A lista completa das tags do convidado (substitui a anterior; Tags RN07). */
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX)
  @IsUUID('all', { each: true })
  tagIds?: string[];
}

/** Editar grupo (RN09): todos os campos opcionais; os que não vêm não mudam. */
export class UpdatePartyBody {
  @OptionalNotNull()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PARTY_NAME_MAX)
  name?: string;

  /** Os editados (com id) e os novos (sem id). Não tira convidado: tirar é a lixeira. */
  @ApiProperty({ type: [UpdatePartyGuestBody], required: false })
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(GUESTS_PER_PARTY_MAX)
  @ValidateNested({ each: true })
  @Type(() => UpdatePartyGuestBody)
  guests?: UpdatePartyGuestBody[];

  /** Convidado com nome do grupo, com telefone ou e-mail (RN06). */
  @OptionalNotNull() @IsUUID() contactGuestId?: string;

  @ApiProperty({ required: false, minimum: 0, maximum: PLUS_ONE_SLOTS_MAX })
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  @Max(PLUS_ONE_SLOTS_MAX)
  plusOneSlots?: number;

  /** A lista completa das tags do grupo (substitui a anterior). */
  @OptionalNotNull()
  @IsArray()
  @ArrayMaxSize(TAGS_MAX)
  @IsUUID('all', { each: true })
  tagIds?: string[];

  /** null ou vazio apaga. */
  @ApiProperty({ required: false, nullable: true, type: String })
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(INTERNAL_NOTE_MAX)
  internalNote?: string | null;
}

export class MoveGuestBody {
  /** O grupo de destino: ativo, do mesmo casamento e diferente do atual. */
  @IsUUID() partyId: string;
}

export class MoveGuestResponse {
  guestId: string;
  fromPartyId: string;
  toPartyId: string;
}

export class ListPartiesQuery {
  /** Nome do grupo ou de um convidado, sem diferenciar maiúsculas nem acentos (RN13). */
  @IsOptional() @Transform(trimOptional) @IsString() @MaxLength(80) q?: string;

  @ApiProperty({ enum: RSVP_STATUSES, required: false })
  @IsOptional()
  @IsIn(RSVP_STATUSES)
  rsvp?: RsvpStatus;

  @ApiProperty({ enum: DELIVERY_STATUSES, required: false })
  @IsOptional()
  @IsIn(DELIVERY_STATUSES)
  sent?: DeliveryStatus;

  @IsOptional() @IsUUID() tag?: string;

  @IsOptional() @IsString() @MaxLength(500) cursor?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class TagSummaryResponse {
  id: string;
  name: string;
  @ApiProperty({ enum: TAG_COLORS, nullable: true, type: String }) color: TagColor | null;
}

export class PartyGuestResponse {
  id: string;
  /** Nulo só na vaga de acompanhante vazia. */
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: AGE_GROUPS, nullable: true, type: String }) ageGroup: AgeGroup | null;
  @ApiProperty({ type: String, nullable: true }) dietaryRestriction: string | null;
  /** Inteiro, em E.164: o formulário de edição precisa dele; o painel mascara. */
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  isPlusOne: boolean;
  @ApiProperty({ enum: RSVP_STATUSES }) rsvpStatus: RsvpStatus;
  @ApiProperty({ type: [TagSummaryResponse] }) tags: TagSummaryResponse[];
}

export class PartyLinkResponse {
  /** <SITE_URL>/<slug>/grupo/<token>; nulo enquanto o casamento não tem endereço. */
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) regeneratedAt: string | null;
}

/** Envio, visualização e resposta: enche na Fase 4. */
export class PartyHistoryEntryResponse {
  @ApiProperty({ enum: ['sent', 'viewed', 'responded'] }) kind: 'sent' | 'viewed' | 'responded';
  @ApiProperty({ format: 'date-time' }) at: string;
}

export class PartyResponse {
  id: string;
  name: string;
  @ApiProperty({ type: String, nullable: true }) contactGuestId: string | null;
  plusOneSlots: number;
  @ApiProperty({ type: String, nullable: true }) internalNote: string | null;
  @ApiProperty({ type: [TagSummaryResponse] }) tags: TagSummaryResponse[];
  link: PartyLinkResponse;
  @ApiProperty({ enum: DELIVERY_STATUSES }) deliveryStatus: DeliveryStatus;
  /** Na ordem do grupo, vagas no fim (RN17). */
  @ApiProperty({ type: [PartyGuestResponse] }) guests: PartyGuestResponse[];
  /** Do mais novo para o mais antigo; vazio até a Fase 4. */
  @ApiProperty({ type: [PartyHistoryEntryResponse] }) history: PartyHistoryEntryResponse[];

  static from({ party }: { party: PartyView }): PartyResponse {
    return {
      ...party,
      link: {
        url: party.link.url,
        regeneratedAt: party.link.regeneratedAt?.toISOString() ?? null,
      },
      history: [],
    };
  }
}

export class PartyContactResponse {
  guestId: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  /** Nunca o número inteiro (RN13; decisão 186, item 11); nulo se só tem e-mail. */
  @ApiProperty({ type: String, nullable: true, example: '(19) 9****-3310' })
  phoneMasked: string | null;
}

export class PartyCountsResponse {
  confirmed: number;
  declined: number;
  pending: number;
  /** Vagas vazias ainda pendentes ("1 vaga pendente"). */
  pendingPlusOnes: number;
}

export class PartyListItemResponse {
  id: string;
  name: string;
  /** Nulo quando o grupo não tem contato (RN06). */
  @ApiProperty({ type: PartyContactResponse, nullable: true }) contact: PartyContactResponse | null;
  @ApiProperty({ type: String, nullable: true }) firstGuestName: string | null;
  /** Convidados e vagas. */
  people: number;
  counts: PartyCountsResponse;
  @ApiProperty({ enum: DELIVERY_STATUSES }) deliveryStatus: DeliveryStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) respondedAt: string | null;
  /** Fase 4. */
  @ApiProperty({ type: String, nullable: true }) respondedBy: string | null;
  /** Só as do grupo. */
  @ApiProperty({ type: [TagSummaryResponse] }) tags: TagSummaryResponse[];
}

export class PartySummaryResponse {
  /** Pessoas e vagas. */
  guests: number;
  /** Só os convidados com nome: o Todos ({n}) da Exportação (decisão 186, item 13). */
  namedGuests: number;
  parties: number;
  confirmed: number;
  declined: number;
  pending: number;
}

export class PartyListResponse {
  /** Do casamento inteiro, sem os filtros. */
  summary: PartySummaryResponse;
  /** Grupos com os filtros ("Mostrando 7 de 58 grupos"). */
  total: number;
  @ApiProperty({ type: [PartyListItemResponse] }) data: PartyListItemResponse[];
  /** Nulo na última página. */
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;

  static from({ list }: { list: PartyList }): PartyListResponse {
    return {
      ...list,
      data: list.data.map((item) => ({
        ...item,
        respondedAt: item.respondedAt?.toISOString() ?? null,
      })),
    };
  }
}

export class RegeneratePartyLinkResponse {
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ format: 'date-time' }) regeneratedAt: string;
}
