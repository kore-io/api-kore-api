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

/** RN01: os repasses estão desligados no ambiente (409 PAYOUTS_DISABLED). */
export class PayoutsDisabledError extends Error {
  override name = 'PayoutsDisabledError';
}

/** RN04: sem CPF ou CNPJ, ou sem chave ativa (409 PAYOUT_DATA_MISSING). */
export class PayoutDataMissingError extends Error {
  override name = 'PayoutDataMissingError';
}

/** RN04: abaixo do mínimo ("Faltam R$ 12,40."; 409 PAYOUT_BELOW_MINIMUM). */
export class PayoutBelowMinimumError extends Error {
  override name = 'PayoutBelowMinimumError';
  constructor(
    readonly balanceCents: number,
    readonly minimumCents: number,
  ) {
    super();
  }
}

/** RN04: um pedido nos últimos 30 dias (409 PAYOUT_TOO_SOON, com a data). */
export class PayoutTooSoonError extends Error {
  override name = 'PayoutTooSoonError';
  constructor(readonly nextRequestAt: Date) {
    super();
  }
}

/** Decisão 247(2): um repasse ainda aberto (409 PAYOUT_OPEN, com o id). */
export class PayoutOpenError extends Error {
  override name = 'PayoutOpenError';
  constructor(readonly payoutId: string) {
    super();
  }
}

/** Decisão 247(1): o saldo mudou desde o Dialog (409 PAYOUT_AMOUNT_CHANGED, com o atual). */
export class PayoutAmountChangedError extends Error {
  override name = 'PayoutAmountChangedError';
  constructor(readonly amountCents: number) {
    super();
  }
}

/** A mesma Idempotency-Key com outro valor (422 IDEMPOTENCY_KEY_REUSED). */
export class PayoutKeyReusedError extends Error {
  override name = 'PayoutKeyReusedError';
}
