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

/** O indicador escolhido é dono do casamento (409 SELF_REFERRAL; decisão 256(3)). */
export class SelfReferralError extends Error {
  override name = 'SelfReferralError';
}

/** O alerta não existe ou não é do papel (404 ALERT_NOT_FOUND; RN12). */
export class AlertNotFoundError extends Error {
  override name = 'AlertNotFoundError';
}

/** Já resolvido (409 ALERT_ALREADY_RESOLVED). */
export class AlertAlreadyResolvedError extends Error {
  override name = 'AlertAlreadyResolvedError';
}

/** As confirmações obrigatórias faltam (422 CHECKS_REQUIRED; RN09). */
export class ChecksRequiredError extends Error {
  override name = 'ChecksRequiredError';
}

/** Os 4 dígitos não são de quem pagou (422 CHECKS_FAILED; RN09). */
export class ChecksFailedError extends Error {
  override name = 'ChecksFailedError';
}

/** O novo e-mail já é de outra conta (409 EMAIL_IN_USE; RN09). */
export class EmailInUseError extends Error {
  override name = 'EmailInUseError';
}

/** O limite de trocas do atendente no dia (429 RATE_LIMITED; decisão 253(1)). */
export class AccessChangeRateLimitedError extends Error {
  override name = 'AccessChangeRateLimitedError';
  constructor(readonly retryAt: Date) {
    super();
  }
}

/** A troca está travada no casamento (409 ACCESS_EMAIL_LOCKED; decisão 253(1)). */
export class AccessEmailLockedError extends Error {
  override name = 'AccessEmailLockedError';
  constructor(readonly availableAt: Date) {
    super();
  }
}

/** Só o Admin faz isto (403 ACTION_NOT_ALLOWED, "Peça ao Admin."; decisão 253(1)). */
export class AdminOnlyError extends Error {
  override name = 'AdminOnlyError';
}

/** Não é dono do casamento, ou é do staff (403 ACTION_NOT_ALLOWED; RN09). */
export class NotAnOwnerError extends Error {
  override name = 'NotAnOwnerError';
}

/** Não há trava para liberar (409 NOT_LOCKED). */
export class NotLockedError extends Error {
  override name = 'NotLockedError';
}

/** A trava já foi liberada nas últimas 24 h (409 UNLOCK_TOO_SOON; decisão 253(1)). */
export class UnlockTooSoonError extends Error {
  override name = 'UnlockTooSoonError';
  constructor(readonly availableAt: Date) {
    super();
  }
}
