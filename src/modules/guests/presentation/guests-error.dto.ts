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

/** Mais de 1.000 convidados na importação (Importação RN10). */
export class TooManyGuestsErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['TOO_MANY_GUESTS'] }) error: 'TOO_MANY_GUESTS';
  @ApiProperty() message: string;
  @ApiProperty({ example: 1000 }) max: number;
}

/** Nome repetido no mesmo grupo na confirmação (Importação RN11). */
export class DuplicateErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['DUPLICATE'] }) error: 'DUPLICATE';
  @ApiProperty() message: string;
  /** A pessoa repetida, ex.: groups.1.guests.2. */
  @ApiProperty({ example: 'groups.1.guests.2' }) path: string;
}

/** Arquivo acima de 5 MB, ou de 50 MB descompactado (ADR-39; decisão 189, item 8). */
export class FileTooLargeErrorBody {
  static readonly status = 413;
  @ApiProperty({ enum: [413] }) statusCode: 413;
  @ApiProperty({ enum: ['FILE_TOO_LARGE'] }) error: 'FILE_TOO_LARGE';
  @ApiProperty() message: string;
  @ApiProperty({ example: 5242880 }) maxBytes: number;
  /** Quando o que passou foi o descompactado (50 MB). */
  @ApiProperty({ required: false, example: 52428800 }) unzippedMaxBytes?: number;
}

/** Regras do arquivo da planilha (Importação RN01 e RN03). */
export class SpreadsheetRefusedErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['NOT_XLSX', 'TEMPLATE_MISMATCH', 'TOO_MANY_ROWS'] })
  error: 'NOT_XLSX' | 'TEMPLATE_MISMATCH' | 'TOO_MANY_ROWS';
  @ApiProperty() message: string;
}

export class NothingToImportErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOTHING_TO_IMPORT'] }) error: 'NOTHING_TO_IMPORT';
  @ApiProperty() message: string;
}

export class NothingToExportErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOTHING_TO_EXPORT'] }) error: 'NOTHING_TO_EXPORT';
  @ApiProperty() message: string;
}
