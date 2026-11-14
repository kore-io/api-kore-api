/** O repasse não existe (404 PAYOUT_NOT_FOUND). */
export class PayoutNotFoundError extends Error {
  override name = 'PayoutNotFoundError';
}

/**
 * O repasse não está no estado que a ação pede (Backoffice - cobrança, Contrato
 * de API; decisão 259(3)): Pagar e Recusar pedem requested (409
 * PAYOUT_NOT_REQUESTED; o retido dá 409 PAYOUT_HELD); Tentar de novo pede
 * processing e Liberar pede held (409 PAYOUT_STATUS_CONFLICT).
 */
export class PayoutStatusConflictError extends Error {
  override name = 'PayoutStatusConflictError';
  constructor(
    readonly status: string,
    readonly expected: 'requested' | 'processing' | 'held',
  ) {
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

/** Liberar: abaixo do repasse mínimo depois de tirar as estornadas (409 PAYOUT_BELOW_MINIMUM; RN09). */
export class PayoutBelowMinimumError extends Error {
  override name = 'PayoutBelowMinimumError';
  constructor(
    readonly amountCents: number,
    readonly minimumCents: number,
  ) {
    super();
  }
}

/** Liberar: uma comissão ainda em estorno ou em contestação (409 PAYOUT_STILL_HELD). */
export class PayoutStillHeldError extends Error {
  override name = 'PayoutStillHeldError';
}
