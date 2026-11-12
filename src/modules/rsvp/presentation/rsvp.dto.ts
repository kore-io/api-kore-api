import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { RSVP_STATUSES, type RsvpStatus } from '../../guests/domain/party';
import type { RsvpView } from '../application/rsvp-view';

/**
 * A resposta de um convidado (RSVP, contrato; R2-5). Os tamanhos (restrição
 * até 200, música até 120, nome da vaga até 80) voltam como TOO_LONG no
 * caminho do campo.
 */
export class RsvpAnswerBody {
  @IsUUID() id: string;

  /** `pending` só na vaga. */
  @ApiProperty({ enum: RSVP_STATUSES }) @IsIn(RSVP_STATUSES) status: RsvpStatus;

  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsString()
  dietaryRestriction?: string | null;

  /** Ignorada com Não vou e com a pergunta desligada (Música RN04). */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsString()
  songSuggestion?: string | null;

  /** Só na vaga: o nome do acompanhante com Vou levar (RN05). */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsString()
  name?: string | null;
}

export class PutRsvpBody {
  /** A `version` do grupo lida no GET (decisão 216, D11). */
  @IsInt() @Min(1) version: number;

  /** Quem está respondendo: um convidado com nome do grupo (RN04). */
  @IsUUID() signedByGuestId: string;

  /** Todos os convidados com nome do grupo; a vaga pode faltar. */
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => RsvpAnswerBody)
  guests: RsvpAnswerBody[];
}

class RsvpPartyResponse {
  id: string;
  name: string;
  version: number;
}

class RsvpGuestResponse {
  id: string;
  /** Nulo na vaga vazia. */
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  isPlusOne: boolean;
  @ApiProperty({ enum: RSVP_STATUSES }) rsvpStatus: RsvpStatus;
  @ApiProperty({ type: String, nullable: true }) dietaryRestriction: string | null;
  @ApiProperty({ type: String, nullable: true }) songSuggestion: string | null;
}

class RsvpSongQuestionResponse {
  enabled: boolean;
  /** O texto do casal, ou o padrão "Que música não pode faltar na festa?". */
  text: string;
}

class RsvpContactResponse {
  @ApiProperty({ type: String, nullable: true }) whatsapp: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
}

/** O formulário do grupo (RN03 e RN08); também a resposta do PUT e o `current` do 409. */
export class RsvpResponse {
  @ApiProperty({ type: RsvpPartyResponse }) party: RsvpPartyResponse;
  @ApiProperty({ type: [RsvpGuestResponse] }) guests: RsvpGuestResponse[];
  plusOneSlots: number;
  @ApiProperty({ type: String, nullable: true, example: '2026-10-15' }) rsvpDeadline: string | null;
  @ApiProperty({ enum: ['open', 'deadline_passed', 'post_event', 'preview'] })
  state: RsvpView['state'];
  @ApiProperty({ type: RsvpSongQuestionResponse }) songQuestion: RsvpSongQuestionResponse;
  @ApiProperty({ type: RsvpContactResponse }) contact: RsvpContactResponse;
}

/** Sem o cookie do grupo, ou ele não vale mais (RN11): "Este link não funciona mais." */
export class PartySessionInvalidErrorBody {
  static readonly status = 401;
  @ApiProperty({ enum: [401] }) statusCode: 401;
  @ApiProperty({ enum: ['PARTY_SESSION_INVALID'] }) error: 'PARTY_SESSION_INVALID';
  @ApiProperty() message: string;
}

/** Na prévia, as respostas não são enviadas (RN01). */
export class PreviewReadOnlyErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['PREVIEW_READ_ONLY'] }) error: 'PREVIEW_READ_ONLY';
  @ApiProperty() message: string;
}

/** As respostas mudaram enquanto o grupo preenchia (RN07 e RN11), com as atuais. */
export class RsvpChangedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['RSVP_CHANGED'] }) error: 'RSVP_CHANGED';
  @ApiProperty() message: string;
  @ApiProperty({ type: RsvpResponse }) current: RsvpResponse;
}

/** Depois do prazo ou no pós-evento (RN08). */
export class RsvpClosedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['RSVP_CLOSED'] }) error: 'RSVP_CLOSED';
  @ApiProperty() message: string;
  @ApiProperty({ enum: ['deadline_passed', 'post_event'] }) reason:
    'deadline_passed' | 'post_event';
}

/** 20 gravações por minuto por IP e grupo, ou 50 por dia por grupo (RN10). */
export class RsvpRateLimitedErrorBody {
  static readonly status = 429;
  @ApiProperty({ enum: [429] }) statusCode: 429;
  @ApiProperty({ enum: ['RSVP_RATE_LIMITED', 'RSVP_LIMIT'] }) error:
    'RSVP_RATE_LIMITED' | 'RSVP_LIMIT';
  @ApiProperty() message: string;
}
