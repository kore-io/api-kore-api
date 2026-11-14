import { ApiProperty } from '@nestjs/swagger';

/** Fora do staff (Backoffice - acesso RN01): sem dizer qual dos motivos. */
export class StaffOnlyErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['STAFF_ONLY'] }) error: 'STAFF_ONLY';
  @ApiProperty() message: string;
}

export class AlreadyBlockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALREADY_BLOCKED'] }) error: 'ALREADY_BLOCKED';
  @ApiProperty() message: string;
}

export class NotBlockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOT_BLOCKED'] }) error: 'NOT_BLOCKED';
  @ApiProperty() message: string;
}

export class AlertNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['ALERT_NOT_FOUND'] }) error: 'ALERT_NOT_FOUND';
  @ApiProperty() message: string;
}

export class AlertAlreadyResolvedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALERT_ALREADY_RESOLVED'] }) error: 'ALERT_ALREADY_RESOLVED';
  @ApiProperty() message: string;
}

export class AlreadyPaidErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALREADY_PAID'] }) error: 'ALREADY_PAID';
  @ApiProperty() message: string;
  /** Quando a publicação foi paga ("Indisponível: a publicação foi paga em 10/08."). */
  @ApiProperty({ format: 'date-time' }) paidAt: string;
}

export class ReassignPaymentPendingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYMENT_PENDING'] }) error: 'PAYMENT_PENDING';
  @ApiProperty() message: string;
}

export class ReferrerNotActiveErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFERRER_NOT_ACTIVE'] }) error: 'REFERRER_NOT_ACTIVE';
  @ApiProperty() message: string;
}

export class GuestNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['GUEST_NOT_FOUND'] }) error: 'GUEST_NOT_FOUND';
  @ApiProperty() message: string;
}

export class SelfReferralErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SELF_REFERRAL'] }) error: 'SELF_REFERRAL';
  @ApiProperty() message: string;
}
export class ChecksRequiredErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['CHECKS_REQUIRED'] }) error: 'CHECKS_REQUIRED';
  @ApiProperty() message: string;
}

export class ChecksFailedErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['CHECKS_FAILED'] }) error: 'CHECKS_FAILED';
  @ApiProperty() message: string;
}

export class EmailInUseErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['EMAIL_IN_USE'] }) error: 'EMAIL_IN_USE';
  @ApiProperty() message: string;
}

/** O limite do atendente no dia (decisão 253(1)): "Você chegou ao limite de trocas de hoje. Peça ao Admin." */
export class AccessChangeRateLimitedErrorBody {
  static readonly status = 429;
  @ApiProperty({ enum: [429] }) statusCode: 429;
  @ApiProperty({ enum: ['RATE_LIMITED'] }) error: 'RATE_LIMITED';
  @ApiProperty() message: string;
  /** O começo do próximo dia de Brasília. */
  @ApiProperty({ format: 'date-time' }) retryAt: string;
}

export class AccessEmailLockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ACCESS_EMAIL_LOCKED'] }) error: 'ACCESS_EMAIL_LOCKED';
  @ApiProperty() message: string;
  @ApiProperty({ format: 'date-time' }) availableAt: string;
}

export class NotLockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOT_LOCKED'] }) error: 'NOT_LOCKED';
  @ApiProperty() message: string;
}

export class UnlockTooSoonErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['UNLOCK_TOO_SOON'] }) error: 'UNLOCK_TOO_SOON';
  @ApiProperty() message: string;
  @ApiProperty({ format: 'date-time' }) availableAt: string;
}

export class NoOwnerErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NO_OWNER'] }) error: 'NO_OWNER';
  @ApiProperty() message: string;
}

export class SupportSessionNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['SUPPORT_SESSION_NOT_FOUND'] }) error: 'SUPPORT_SESSION_NOT_FOUND';
  @ApiProperty() message: string;
}

/** A fila de Repasses (Backoffice - cobrança RN09; Contrato de API e decisão 259(3)). */
export class PayoutNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PAYOUT_NOT_FOUND'] }) error: 'PAYOUT_NOT_FOUND';
  @ApiProperty() message: string;
}

export class PayoutNotRequestedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUT_NOT_REQUESTED'] }) error: 'PAYOUT_NOT_REQUESTED';
  @ApiProperty() message: string;
  /** O estado atual do repasse. */
  @ApiProperty() status: string;
}

export class PayoutHeldErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUT_HELD'] }) error: 'PAYOUT_HELD';
  @ApiProperty() message: string;
}

/** Tentar de novo fora de processing, Liberar fora de held. */
export class PayoutStatusConflictErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUT_STATUS_CONFLICT'] }) error: 'PAYOUT_STATUS_CONFLICT';
  @ApiProperty() message: string;
  @ApiProperty() status: string;
}

export class PayoutsDisabledAdminErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUTS_DISABLED'] }) error: 'PAYOUTS_DISABLED';
  @ApiProperty() message: string;
}

export class ReferrerBlockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFERRER_BLOCKED'] }) error: 'REFERRER_BLOCKED';
  @ApiProperty() message: string;
}

export class PayoutPixKeyChangePendingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PIX_KEY_CHANGE_PENDING'] }) error: 'PIX_KEY_CHANGE_PENDING';
  @ApiProperty() message: string;
}

export class PayoutAmountMismatchErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUT_AMOUNT_MISMATCH'] }) error: 'PAYOUT_AMOUNT_MISMATCH';
  @ApiProperty() message: string;
  amountCents: number;
  /** A soma das comissões não estornadas e dos ajustes. */
  itemsCents: number;
}

export class PayoutBelowMinimumAdminErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYOUT_BELOW_MINIMUM'] }) error: 'PAYOUT_BELOW_MINIMUM';
  @ApiProperty() message: string;
  /** O valor recalculado. */
  amountCents: number;
  minimumCents: number;
}
