import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  InvalidLoginCodeError,
  LoginChallengeExpiredError,
  LoginChallengeLockedError,
  LoginRequestLimitError,
  LoginRequestTooSoonError,
  ReferralNotFoundError,
  AlreadyOwnerError,
  SlugUnavailableError,
  TermsVersionOutdatedError,
  SessionExpiredError,
  UserBlockedError,
  WeddingActionForbiddenError,
  WeddingNotFoundError,
} from '../domain/access.errors';

/** Erros de regra no formato nativo, com o código no campo error (decisão 99). */
export function toHttpError(error: unknown): unknown {
  if (error instanceof SessionExpiredError) {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'SESSION_EXPIRED',
      message: 'Session expired or ended.',
    });
  }
  if (error instanceof LoginRequestTooSoonError) {
    return new HttpException(
      {
        statusCode: 429,
        error: 'TOO_SOON',
        message: 'Wait before requesting another code.',
        resendAvailableAt: error.resendAvailableAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof LoginRequestLimitError) {
    return new HttpException(
      {
        statusCode: 429,
        error: 'TOO_MANY_REQUESTS',
        message: 'Too many codes requested.',
        retryAfterMinutes: error.retryAfterMinutes,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof InvalidLoginCodeError) {
    return new UnauthorizedException({
      statusCode: 401,
      error: 'INVALID_CODE',
      message: 'Wrong code.',
      attemptsLeft: error.attemptsLeft,
    });
  }
  if (error instanceof LoginChallengeExpiredError) {
    return new GoneException({
      statusCode: 410,
      error: 'CHALLENGE_EXPIRED',
      message: 'Login code expired, used or replaced.',
    });
  }
  if (error instanceof LoginChallengeLockedError) {
    return new GoneException({
      statusCode: 410,
      error: 'CHALLENGE_LOCKED',
      message: 'Too many wrong codes.',
      newCodeSent: error.newCodeSent,
      ...(error.retryAfterMinutes !== undefined && { retryAfterMinutes: error.retryAfterMinutes }),
    });
  }
  if (error instanceof WeddingNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'WEDDING_NOT_FOUND',
      message: 'Wedding not found.',
    });
  }
  if (error instanceof WeddingActionForbiddenError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'ACTION_NOT_ALLOWED',
      message: 'Your role in this wedding does not allow this action.',
    });
  }
  if (error instanceof ReferralNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'REFERRAL_NOT_FOUND',
      message: 'Referral not found.',
    });
  }
  if (error instanceof SlugUnavailableError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SLUG_UNAVAILABLE',
      message: 'Wedding address taken or reserved.',
      suggestion: error.suggestion,
    });
  }
  if (error instanceof AlreadyOwnerError) {
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_OWNER',
      message: 'You already own an active wedding.',
      weddingId: error.weddingId,
    });
  }
  if (error instanceof TermsVersionOutdatedError) {
    return new ConflictException({
      statusCode: 409,
      error: 'TERMS_VERSION_OUTDATED',
      message: 'The terms changed; accept the current version.',
    });
  }
  if (error instanceof UserBlockedError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'USER_BLOCKED',
      message: 'User is blocked.',
    });
  }
  return error;
}

/** Corpo do verify sem um dos dois jeitos válidos: 400 nativo (decisão 99). */
export function invalidVerifyBody(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: ['send either email and code, or token'],
  });
}
