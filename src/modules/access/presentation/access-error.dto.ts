import { ApiProperty } from '@nestjs/swagger';

/** Erros de regra do contexto Acesso (contratos de Login; decisões 99 e 150). */
export class TooSoonErrorBody {
  static readonly status = 429;
  @ApiProperty({ enum: [429] }) statusCode: 429;
  @ApiProperty({ enum: ['TOO_SOON'] }) error: 'TOO_SOON';
  @ApiProperty() message: string;
  /** Quando o "Reenviar código" volta (RN04). */
  @ApiProperty({ format: 'date-time' }) resendAvailableAt: string;
}

export class TooManyCodeRequestsErrorBody {
  static readonly status = 429;
  @ApiProperty({ enum: [429] }) statusCode: 429;
  @ApiProperty({ enum: ['TOO_MANY_REQUESTS'] }) error: 'TOO_MANY_REQUESTS';
  @ApiProperty() message: string;
  /** "Tente de novo em {minutos} minutos" (RN04). */
  @ApiProperty() retryAfterMinutes: number;
}

export class InvalidCodeErrorBody {
  static readonly status = 401;
  @ApiProperty({ enum: [401] }) statusCode: 401;
  @ApiProperty({ enum: ['INVALID_CODE'] }) error: 'INVALID_CODE';
  @ApiProperty() message: string;
  /** Tentativas que ainda restam antes de o pedido cair (RN05). */
  @ApiProperty() attemptsLeft: number;
}

export class ChallengeExpiredErrorBody {
  static readonly status = 410;
  @ApiProperty({ enum: [410] }) statusCode: 410;
  @ApiProperty({ enum: ['CHALLENGE_EXPIRED'] }) error: 'CHALLENGE_EXPIRED';
  @ApiProperty() message: string;
}

export class ChallengeLockedErrorBody {
  static readonly status = 410;
  @ApiProperty({ enum: [410] }) statusCode: 410;
  @ApiProperty({ enum: ['CHALLENGE_LOCKED'] }) error: 'CHALLENGE_LOCKED';
  @ApiProperty() message: string;
  /** Se um código novo foi enviado sozinho (RN05). */
  @ApiProperty() newCodeSent: boolean;
  /** Só sem código novo: em quantos minutos pode pedir outro (decisão 150). */
  @ApiProperty({ required: false }) retryAfterMinutes?: number;
}

export class UserBlockedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['USER_BLOCKED'] }) error: 'USER_BLOCKED';
  @ApiProperty() message: string;
}

export class ReferralNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['REFERRAL_NOT_FOUND'] }) error: 'REFERRAL_NOT_FOUND';
  @ApiProperty() message: string;
}

export class SlugUnavailableErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SLUG_UNAVAILABLE'] }) error: 'SLUG_UNAVAILABLE';
  @ApiProperty() message: string;
  /** Alternativa livre, com o ano ou um número (RN05). */
  @ApiProperty({ type: String, nullable: true }) suggestion: string | null;
}

export class AlreadyOwnerErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALREADY_OWNER'] }) error: 'ALREADY_OWNER';
  @ApiProperty() message: string;
  /** O casamento que a pessoa já tem, para o botão de abri-lo (RN06). */
  @ApiProperty() weddingId: string;
}

export class TermsVersionOutdatedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['TERMS_VERSION_OUTDATED'] }) error: 'TERMS_VERSION_OUTDATED';
  @ApiProperty() message: string;
}

export class ActionNotAllowedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['ACTION_NOT_ALLOWED'] }) error: 'ACTION_NOT_ALLOWED';
  @ApiProperty() message: string;
}

export class WeddingNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['WEDDING_NOT_FOUND'] }) error: 'WEDDING_NOT_FOUND';
  @ApiProperty() message: string;
}

export class InvitationNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['INVITATION_NOT_FOUND'] }) error: 'INVITATION_NOT_FOUND';
  @ApiProperty() message: string;
}

export class OwnersFullErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['OWNERS_FULL'] }) error: 'OWNERS_FULL';
  @ApiProperty() message: string;
}

export class PlannerAlreadyErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PLANNER_ALREADY'] }) error: 'PLANNER_ALREADY';
  @ApiProperty() message: string;
}

export class NotPendingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOT_PENDING'] }) error: 'NOT_PENDING';
  @ApiProperty() message: string;
}
