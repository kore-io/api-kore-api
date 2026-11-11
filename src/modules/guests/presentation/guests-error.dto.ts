import { ApiProperty } from '@nestjs/swagger';

/** Erros de regra do contexto Convidados, no formato nativo (decisão 99). */
export class PartyNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PARTY_NOT_FOUND'] }) error: 'PARTY_NOT_FOUND';
  @ApiProperty() message: string;
}

export class GuestNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['GUEST_NOT_FOUND'] }) error: 'GUEST_NOT_FOUND';
  @ApiProperty() message: string;
}

/** Último convidado com nome do grupo (RN08); o app mostra o texto pelo perfil. */
export class LastGuestErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['LAST_GUEST'] }) error: 'LAST_GUEST';
  @ApiProperty() message: string;
}

/** Vaga de acompanhante vazia (RN10). */
export class EmptyPlusOneErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['EMPTY_PLUS_ONE'] }) error: 'EMPTY_PLUS_ONE';
  @ApiProperty() message: string;
}

/** As vagas pedidas ficam abaixo das preenchidas ou respondidas (RN07). */
export class PlusOnesInUseErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PLUS_ONES_IN_USE'] }) error: 'PLUS_ONES_IN_USE';
  @ApiProperty() message: string;
  /** "Já há {n} acompanhantes com resposta neste grupo." */
  @ApiProperty() inUse: number;
}
