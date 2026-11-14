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

/** O alerta não existe ou não é do papel (404 ALERT_NOT_FOUND; RN12). */
export class AlertNotFoundError extends Error {
  override name = 'AlertNotFoundError';
}

/** Já resolvido (409 ALERT_ALREADY_RESOLVED). */
export class AlertAlreadyResolvedError extends Error {
  override name = 'AlertAlreadyResolvedError';
}
