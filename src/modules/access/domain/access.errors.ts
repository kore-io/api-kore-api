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

/** Sem vínculo ativo: "não encontrado", para não revelar que o casamento existe (RN01 de Papéis). */
export class WeddingNotFoundError extends Error {
  override name = 'WeddingNotFoundError';
}

/** Com vínculo, mas o papel não permite a ação (RN02 a RN04 de Papéis). */
export class WeddingActionForbiddenError extends Error {
  override name = 'WeddingActionForbiddenError';
}

/** RN08 de Cadastro: código inexistente, indicador inativo ou bloqueado. */
export class ReferralNotFoundError extends Error {
  override name = 'ReferralNotFoundError';
}

/** RN05 de Cadastro: endereço em uso ou reservado, com uma alternativa livre. */
export class SlugUnavailableError extends Error {
  override name = 'SlugUnavailableError';
  readonly suggestion: string | null;

  constructor({ suggestion }: { suggestion: string | null }) {
    super();
    this.suggestion = suggestion;
  }
}

/** RN06 de Cadastro: a pessoa já é dona de um casamento ativo. */
export class AlreadyOwnerError extends Error {
  override name = 'AlreadyOwnerError';
  readonly weddingId: string;

  constructor({ weddingId }: { weddingId: string }) {
    super();
    this.weddingId = weddingId;
  }
}

/** RN11 de Cadastro: o app mostrou outra versão dos Termos (decisão 166). */
export class TermsVersionOutdatedError extends Error {
  override name = 'TermsVersionOutdatedError';
}

/** RN02 de Convites: o casamento já tem 2 donos. */
export class OwnersFullError extends Error {
  override name = 'OwnersFullError';
}

/** RN02 de Convites: o casamento já tem cerimonialista. */
export class PlannerAlreadyError extends Error {
  override name = 'PlannerAlreadyError';
}

/** Decisão 170(4): o casal já tem 2 convites por e-mail pendentes. */
export class CoupleInvitationsFullError extends Error {
  override name = 'CoupleInvitationsFullError';
}

/** RN01 e RN14 de Convites: e-mails fora do que o tipo aceita (400 nativo). */
export class InvalidInvitationRecipientsError extends Error {
  override name = 'InvalidInvitationRecipientsError';
}

/** RN05 de Convites: o convite já foi aceito, recusado, cancelado, substituído ou venceu. */
export class InvitationNotPendingError extends Error {
  override name = 'InvitationNotPendingError';
}

/** O convite não existe neste casamento (ou a pessoa não o vê). */
export class InvitationNotFoundError extends Error {
  override name = 'InvitationNotFoundError';
}

/** RN03 e RN12 de Convites: o link já não vale (410, só com o motivo). */
export class InvitationInvalidError extends Error {
  override name = 'InvitationInvalidError';
  readonly reason: 'expired' | 'used' | 'revoked' | 'superseded';

  constructor({ reason }: { reason: 'expired' | 'used' | 'revoked' | 'superseded' }) {
    super();
    this.reason = reason;
  }
}

/** RN07 de Convites: a sessão é de outro e-mail, e a pessoa não confirmou. */
export class EmailMismatchError extends Error {
  override name = 'EmailMismatchError';
}

/** Decisão 172, item 3: a pessoa já tem vínculo com este casamento. */
export class AlreadyMemberError extends Error {
  override name = 'AlreadyMemberError';
}

/** RN11 de Convites; decisão 136, item 8: o link sem e-mail não tem Recusar. */
export class InvitationNotDeclinableError extends Error {
  override name = 'InvitationNotDeclinableError';
}

/** Decisões 168 e 172: falta um dado do aceite (quem é você, noivo ou noiva, ou o nome). */
export class AcceptanceDetailsMissingError extends Error {
  override name = 'AcceptanceDetailsMissingError';
  readonly field: string;

  constructor({ field }: { field: string }) {
    super();
    this.field = field;
  }
}
