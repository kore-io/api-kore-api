/** O repasse não existe (404 PAYOUT_NOT_FOUND). */
export class PayoutNotFoundError extends Error {
  override name = 'PayoutNotFoundError';
}

/** Pagar só sai de requested; Tentar de novo, só de processing (409 PAYOUT_STATUS_CONFLICT). */
export class PayoutStatusConflictError extends Error {
  override name = 'PayoutStatusConflictError';
  constructor(readonly status: string) {
    super();
  }
}

/** RN01: os repasses estão desligados no ambiente (409 PAYOUTS_DISABLED). */
export class PayoutPaymentsDisabledError extends Error {
  override name = 'PayoutPaymentsDisabledError';
}

/** RN05: o indicador está bloqueado (409 REFERRER_BLOCKED; o repasse fica retido, RN06 (c)). */
export class PayoutReferrerBlockedError extends Error {
  override name = 'PayoutReferrerBlockedError';
}

/** RN05: uma troca da chave Pix em curso (409 PIX_KEY_CHANGE_PENDING). */
export class PayoutPixKeyChangePendingError extends Error {
  override name = 'PayoutPixKeyChangePendingError';
}

/** RN05 (B7-3): o valor do repasse não bate com as comissões e os ajustes (409 PAYOUT_AMOUNT_MISMATCH). */
export class PayoutAmountMismatchError extends Error {
  override name = 'PayoutAmountMismatchError';
  constructor(
    readonly amountCents: number,
    readonly itemsCents: number,
  ) {
    super();
  }
}
