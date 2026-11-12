import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { DATE_ONLY } from '../../access/presentation/weddings.dto';

/** O prazo de resposta (Prazo RN01): `AAAA-MM-DD` ou null para tirar. */
export class RsvpDeadlineBody {
  @ApiProperty({ type: String, nullable: true, example: '2026-10-15' })
  @ValidateIf((_, value) => value !== null)
  @Matches(DATE_ONLY)
  @IsISO8601({ strict: true })
  rsvpDeadline: string | null;
}

export class RsvpDeadlineResponse {
  @ApiProperty({ type: String, nullable: true, example: '2026-10-15' }) rsvpDeadline: string | null;
}

const COUPLE_STATUSES = ['confirmed', 'declined'] as const;

/** Alterar resposta (Prazo RN04): Vai · Não vai, a restrição e, na vaga, o nome. */
export class GuestResponseBody {
  /** A `version` do grupo lida no Painel (R3-7). */
  @IsInt() @Min(1) version: number;

  @ApiProperty({ enum: COUPLE_STATUSES })
  @IsIn(COUPLE_STATUSES)
  status: (typeof COUPLE_STATUSES)[number];

  /** Até 200; apagada com Não vai. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsString()
  dietaryRestriction?: string | null;

  /** Só na vaga: até 80, obrigatório com Vai. */
  @ApiProperty({ type: String, nullable: true, required: false })
  @IsOptional()
  @IsString()
  name?: string | null;
}

export class GuestResponseResponse {
  partyId: string;
  /** A versão nova do grupo. */
  version: number;
}

/** "O prazo precisa ser até o dia do casamento, {data}." (Prazo RN01). */
export class DeadlineAfterEventErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['DEADLINE_AFTER_EVENT'] }) error: 'DEADLINE_AFTER_EVENT';
  @ApiProperty() message: string;
  @ApiProperty({ example: '2026-11-14' }) eventDate: string;
}

/** "Essa data já passou." (Prazo RN01). */
export class DeadlineInPastErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['DEADLINE_IN_PAST'] }) error: 'DEADLINE_IN_PAST';
  @ApiProperty() message: string;
}

/** O grupo mudou com o Dialog aberto (Prazo RN04; R3-7). */
export class GuestResponseChangedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['RSVP_CHANGED'] }) error: 'RSVP_CHANGED';
  @ApiProperty() message: string;
  @ApiProperty({ type: GuestResponseResponse }) current: { version: number };
}
