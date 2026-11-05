/** Sessão vencida, encerrada ou inexistente (RN08 a RN11 de Login). */
export class SessionExpiredError extends Error {
  override name = 'SessionExpiredError';
}

/** RN04: menos de 60 segundos desde o último pedido. */
export class LoginRequestTooSoonError extends Error {
  override name = 'LoginRequestTooSoonError';
  readonly resendAvailableAt: Date;

  constructor({ resendAvailableAt }: { resendAvailableAt: Date }) {
    super();
    this.resendAvailableAt = resendAvailableAt;
  }
}

/** RN04: 5 pedidos na última hora. */
export class LoginRequestLimitError extends Error {
  override name = 'LoginRequestLimitError';
  readonly retryAfterMinutes: number;

  constructor({ retryAfterMinutes }: { retryAfterMinutes: number }) {
    super();
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

/** RN05: código errado, ainda com tentativas. */
export class InvalidLoginCodeError extends Error {
  override name = 'InvalidLoginCodeError';
  readonly attemptsLeft: number;

  constructor({ attemptsLeft }: { attemptsLeft: number }) {
    super();
    this.attemptsLeft = attemptsLeft;
  }
}

/** RN02 e RN04: o pedido venceu, já foi usado ou foi substituído. */
export class LoginChallengeExpiredError extends Error {
  override name = 'LoginChallengeExpiredError';
}

/** RN05: 5 erros invalidaram o pedido; diz se um código novo foi enviado. */
export class LoginChallengeLockedError extends Error {
  override name = 'LoginChallengeLockedError';
  readonly newCodeSent: boolean;
  /** Sem código novo: em quantos minutos pode pedir outro (decisão 150). */
  readonly retryAfterMinutes?: number;

  constructor({
    newCodeSent,
    retryAfterMinutes,
  }: {
    newCodeSent: boolean;
    retryAfterMinutes?: number;
  }) {
    super();
    this.newCodeSent = newCodeSent;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

/** RN11: usuário bloqueado pelo Admin Kore não entra. */
export class UserBlockedError extends Error {
  override name = 'UserBlockedError';
}

/** Google devolveu um e-mail não verificado: o login é recusado (Login, casos de borda). */
export class GoogleEmailUnverifiedError extends Error {
  override name = 'GoogleEmailUnverifiedError';
}
