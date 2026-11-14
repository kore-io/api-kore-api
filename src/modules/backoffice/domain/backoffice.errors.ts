/** O casamento não existe (404 WEDDING_NOT_FOUND). */
export class AdminWeddingNotFoundError extends Error {
  override name = 'AdminWeddingNotFoundError';
}

/** Já bloqueado (409 ALREADY_BLOCKED; Backoffice - acesso, Contrato de API). */
export class AlreadyBlockedError extends Error {
  override name = 'AlreadyBlockedError';
}

/** Não está bloqueado (409 NOT_BLOCKED). */
export class NotBlockedError extends Error {
  override name = 'NotBlockedError';
}

/** A publicação já foi paga (409 ALREADY_PAID; RN07): "Indisponível: a publicação foi paga em 10/08." */
export class AlreadyPaidError extends Error {
  override name = 'AlreadyPaidError';
  constructor(readonly paidAt: Date) {
    super();
  }
}

/** Há pagamento pendente (409 PAYMENT_PENDING; RN07, B9-8). */
export class ReassignPaymentPendingError extends Error {
  override name = 'ReassignPaymentPendingError';
}

/** O indicador escolhido não está ativo (409 REFERRER_NOT_ACTIVE; RN07). */
export class ReferrerNotActiveError extends Error {
  override name = 'ReferrerNotActiveError';
}

/** O convidado não é do casamento (404 GUEST_NOT_FOUND; RN10). */
export class GuestNotFoundForErasureError extends Error {
  override name = 'GuestNotFoundForErasureError';
}

/** O alerta não existe ou não é do papel (404 ALERT_NOT_FOUND; RN12). */
export class AlertNotFoundError extends Error {
  override name = 'AlertNotFoundError';
}

/** Já resolvido (409 ALERT_ALREADY_RESOLVED). */
export class AlertAlreadyResolvedError extends Error {
  override name = 'AlertAlreadyResolvedError';
}
