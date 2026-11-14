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

/**
 * O pendente que o pedido ia trocar já foi pago (Publicar e pagar RN07;
 * B2-4): o Kore aplica o pagamento e não cria outro.
 */
export class PaymentAlreadyPaidError extends Error {
  override name = 'PaymentAlreadyPaidError';
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

/** O pagamento não é deste casamento, ou não existe (Pagamentos e arrependimento, Contrato de API). */
export class PaymentNotFoundError extends Error {
  override name = 'PaymentNotFoundError';
}

/** Só se desiste de um pagamento pago e aplicado (409 PAYMENT_NOT_PAID). */
export class PaymentNotPaidError extends Error {
  override name = 'PaymentNotPaidError';
}

/** Em contestação não há Desistir (Pagamentos e arrependimento RN02; 409 PAYMENT_DISPUTED). */
export class PaymentDisputedError extends Error {
  override name = 'PaymentDisputedError';
}

/** O reembolso deste pagamento já foi pedido (RN04; 409 REFUND_ALREADY_REQUESTED). */
export class RefundAlreadyRequestedError extends Error {
  override name = 'RefundAlreadyRequestedError';
}

/** Há uma extensão (ou cortesia) mais recente (RN03; 409 REFUND_NOT_LAST_EXTENSION). */
export class RefundNotLastExtensionError extends Error {
  override name = 'RefundNotLastExtensionError';
}

/**
 * O prazo de 7 dias terminou (RN02; 409 REFUND_WINDOW_CLOSED). Leva o último
 * instante do prazo, para o Toast "O prazo para desistir terminou em 17 de ago.".
 */
export class RefundWindowClosedError extends Error {
  override name = 'RefundWindowClosedError';
  constructor(readonly refundableUntil: Date | null) {
    super();
  }
}

/** Casamento bloqueado: o app não desiste (RN02; decisão 83; 403 WEDDING_BLOCKED). */
export class BillingWeddingBlockedError extends Error {
  override name = 'BillingWeddingBlockedError';
}

/** Exclusão agendada: nada de pagar nem mudar a data (409 WEDDING_DELETION_SCHEDULED; RN10). */
export class WeddingDeletionScheduledError extends Error {
  override name = 'WeddingDeletionScheduledError';
}

/** A data nova passa do paidThrough: para isso, paga-se a extensão (422 END_DATE_BEYOND_PAID; RN05). */
export class EndDateBeyondPaidError extends Error {
  override name = 'EndDateBeyondPaidError';
  constructor(readonly paidThrough: string) {
    super();
  }
}

/** O nome digitado não é o do casal (422 CONFIRM_NAME_MISMATCH; Retenção RN05). */
export class ConfirmNameMismatchError extends Error {
  override name = 'ConfirmNameMismatchError';
}

/**
 * Algum pagamento ainda está nos 7 dias do CDC (409 REFUND_WINDOW_OPEN;
 * Retenção RN06): a tela oferece o Desistir antes de excluir.
 */
export class RefundWindowOpenError extends Error {
  override name = 'RefundWindowOpenError';
  constructor(readonly refundableUntil: Date) {
    super();
  }
}

/** Nada para cancelar (409 NO_DELETION_SCHEDULED; Retenção RN05). */
export class NoDeletionScheduledError extends Error {
  override name = 'NoDeletionScheduledError';
}
