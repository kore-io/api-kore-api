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

export class TagNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['TAG_NOT_FOUND'] }) error: 'TAG_NOT_FOUND';
  @ApiProperty() message: string;
}

/** 10 tags ativas (RN01); o app escolhe o texto pelo perfil. */
export class TagLimitReachedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TAG_LIMIT_REACHED'] }) error: 'TAG_LIMIT_REACHED';
  @ApiProperty() message: string;
}

/** "Já existe uma tag com este nome." (RN02). */
export class TagNameTakenErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TAG_NAME_TAKEN'] }) error: 'TAG_NAME_TAKEN';
  @ApiProperty() message: string;
  /** Na restauração: o nome da tag ativa que conflita (Lixeira RN09). */
  @ApiProperty({ required: false }) conflictName?: string;
}

/** Cerimonialista ou vendedor tirando quem já respondeu (Lixeira RN07; 189(2)). */
export class AlreadyRespondedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['ALREADY_RESPONDED'] }) error: 'ALREADY_RESPONDED';
  @ApiProperty() message: string;
}

export class TrashItemNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['TRASH_ITEM_NOT_FOUND'] }) error: 'TRASH_ITEM_NOT_FOUND';
  @ApiProperty() message: string;
}
