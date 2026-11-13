/** RN02: o CPF ou CNPJ já foi cadastrado; só o Admin corrige (409 TAX_ID_LOCKED). */
export class TaxIdLockedError extends Error {
  override name = 'TaxIdLockedError';
}

/** RN02: o CPF ou CNPJ é de outro indicador, sem dizer de quem (409 TAX_ID_IN_USE). */
export class TaxIdInUseError extends Error {
  override name = 'TaxIdInUseError';
}

/** RN03: uma troca confirmada ainda não vale (409 PIX_KEY_CHANGE_PENDING, com a data). */
export class PixKeyChangePendingError extends Error {
  override name = 'PixKeyChangePendingError';
  constructor(readonly activeFrom: Date) {
    super();
  }
}

/** RN03: o link da chave venceu (410 PIX_KEY_LINK_EXPIRED; "Este link venceu. Peça a troca de novo."). */
export class PixKeyLinkExpiredError extends Error {
  override name = 'PixKeyLinkExpiredError';
}

/** RN03: o link não é de uma chave dela esperando a confirmação (404 PIX_KEY_NOT_FOUND). */
export class PixKeyNotFoundError extends Error {
  override name = 'PixKeyNotFoundError';
}
