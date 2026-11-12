/** Publicação de casamento fora de rascunho (Preço RN04; Publicar e pagar RN01). */
export class BillingNotDraftError extends Error {
  override name = 'BillingNotDraftError';
}

/** Extensão de casamento que nunca publicou (Data de saída do ar; Preço RN04). */
export class NotPublishedError extends Error {
  override name = 'NotPublishedError';
}

/** Sem data do casamento ou sem fuso (Preço RN04; Cortesia RN04). */
export class BillingEventDateMissingError extends Error {
  override name = 'BillingEventDateMissingError';
}

/** Sem endereço do site (Publicar e pagar RN01). */
export class BillingSlugMissingError extends Error {
  override name = 'BillingSlugMissingError';
}

/** Data de saída do ar fora dos limites (Preço RN03). */
export class BillingEndDateOutOfRangeError extends Error {
  override name = 'BillingEndDateOutOfRangeError';
  constructor(
    readonly endDateMin: string | null,
    readonly endDateMax: string | null,
  ) {
    super();
  }
}

/** Já há um pagamento pendente desse tipo (Publicar e pagar RN07). */
export class PaymentPendingError extends Error {
  override name = 'PaymentPendingError';
}

/** A publicação anterior ainda está com reembolso em andamento (RN08; B2-9). */
export class RefundInProgressError extends Error {
  override name = 'RefundInProgressError';
}

/** O total ou a versão do preço mudaram desde a cotação (Preço e cotação RN05). */
export class PriceChangedError extends Error {
  override name = 'PriceChangedError';
}

/** A mesma Idempotency-Key com outro corpo (Publicar e pagar RN03; B2-10). */
export class IdempotencyKeyReusedError extends Error {
  override name = 'IdempotencyKeyReusedError';
}

/** O gateway não respondeu; o pagamento ficou pendente e a reconciliação o cobre (RN03, RN11). */
export class PaymentGatewayUnavailableError extends Error {
  override name = 'PaymentGatewayUnavailableError';
  constructor(readonly paymentId: string) {
    super();
  }
}
