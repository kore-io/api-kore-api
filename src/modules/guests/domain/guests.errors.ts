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
