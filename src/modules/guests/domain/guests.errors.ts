/**
 * Uma falha de validação do domínio, no formato do 400 (decisão 190): o
 * caminho do campo no corpo, o código e os parâmetros. O app monta o texto.
 */
export interface FieldIssue {
  path: string;
  code: string;
  params: Record<string, unknown>;
}

/** Campos que o DTO não valida sozinho (telefone, contato, tags): 400 com errors. */
export class GuestFieldsInvalidError extends Error {
  override name = 'GuestFieldsInvalidError';
  readonly issues: readonly FieldIssue[];

  constructor({ issues }: { issues: readonly FieldIssue[] }) {
    super();
    this.issues = issues;
  }
}

/** O grupo não existe neste casamento ou está na lixeira (404 PARTY_NOT_FOUND). */
export class PartyNotFoundError extends Error {
  override name = 'PartyNotFoundError';
}

/** O convidado não existe neste casamento ou está na lixeira (404 GUEST_NOT_FOUND). */
export class GuestNotFoundError extends Error {
  override name = 'GuestNotFoundError';
}

/** O último convidado com nome não sai do grupo (409 LAST_GUEST; Grupos RN08). */
export class LastGuestError extends Error {
  override name = 'LastGuestError';
}

/** Vaga de acompanhante vazia não se move nem vai à lixeira (409 EMPTY_PLUS_ONE; RN10). */
export class EmptyPlusOneError extends Error {
  override name = 'EmptyPlusOneError';
}

/** As vagas pedidas ficam abaixo das já preenchidas ou respondidas (409 PLUS_ONES_IN_USE; RN07). */
export class PlusOnesInUseError extends Error {
  override name = 'PlusOnesInUseError';
  readonly inUse: number;

  constructor({ inUse }: { inUse: number }) {
    super();
    this.inUse = inUse;
  }
}

/** A tag não existe neste casamento ou está na lixeira (404 TAG_NOT_FOUND). */
export class TagNotFoundError extends Error {
  override name = 'TagNotFoundError';
}

/** O casamento já tem 10 tags ativas (409 TAG_LIMIT_REACHED; Tags RN01). */
export class TagLimitReachedError extends Error {
  override name = 'TagLimitReachedError';
}

/**
 * Outra tag ativa tem o mesmo nome, sem diferenciar maiúsculas (409
 * TAG_NAME_TAKEN; Tags RN02). Na restauração, traz o nome da tag ativa
 * (conflictName; Lixeira RN09).
 */
export class TagNameTakenError extends Error {
  override name = 'TagNameTakenError';
  readonly conflictName?: string;

  constructor({ conflictName }: { conflictName?: string } = {}) {
    super();
    this.conflictName = conflictName;
  }
}

/** Colaborador tirando quem já respondeu (403 ALREADY_RESPONDED; Lixeira RN07; 189(2)). */
export class AlreadyRespondedError extends Error {
  override name = 'AlreadyRespondedError';
}

/** O item não está na lixeira deste casamento (404 TRASH_ITEM_NOT_FOUND). */
export class TrashItemNotFoundError extends Error {
  override name = 'TrashItemNotFoundError';
}

/** Mais de 1.000 convidados na importação (422 TOO_MANY_GUESTS; Importação RN10). */
export class TooManyGuestsError extends Error {
  override name = 'TooManyGuestsError';
}

/**
 * Nome repetido no mesmo grupo na confirmação da lista colada (422 DUPLICATE;
 * Importação RN11): o caminho aponta a pessoa repetida.
 */
export class DuplicateGuestError extends Error {
  override name = 'DuplicateGuestError';
  readonly path: string;

  constructor({ path }: { path: string }) {
    super();
    this.path = path;
  }
}
