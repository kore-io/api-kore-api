import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NoOwnerError,
  SupportSessionNotFoundError,
  AccessChangeRateLimitedError,
  AccessEmailLockedError,
  AdminOnlyError,
  ChecksFailedError,
  ChecksRequiredError,
  EmailInUseError,
  NotAnOwnerError,
  NotLockedError,
  UnlockTooSoonError,
  GuestNotFoundForErasureError,
  AlreadyPaidError,
  ReassignPaymentPendingError,
  ReferrerNotActiveError,
  SelfReferralError,
  AlertAlreadyResolvedError,
  AlertNotFoundError,
  AdminWeddingNotFoundError,
  AlreadyBlockedError,
  NotBlockedError,
} from '../domain/backoffice.errors';

/** Erros do Backoffice para HTTP. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof AdminWeddingNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'WEDDING_NOT_FOUND',
      message: 'Wedding not found.',
    });
  if (error instanceof AlreadyBlockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_BLOCKED',
      message: 'The wedding is already blocked.',
    });
  if (error instanceof NotBlockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_BLOCKED',
      message: 'The wedding is not blocked.',
    });
  if (error instanceof AlertNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'ALERT_NOT_FOUND',
      message: 'Alert not found.',
    });
  if (error instanceof AlertAlreadyResolvedError)
    return new ConflictException({
      statusCode: 409,
      error: 'ALERT_ALREADY_RESOLVED',
      message: 'The alert is already resolved.',
    });
  if (error instanceof AlreadyPaidError)
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_PAID',
      message: 'The publication was already paid.',
      paidAt: error.paidAt.toISOString(),
    });
  if (error instanceof ReassignPaymentPendingError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYMENT_PENDING',
      message: 'There is a pending payment quoted with the current referrer.',
    });
  if (error instanceof SelfReferralError)
    return new ConflictException({
      statusCode: 409,
      error: 'SELF_REFERRAL',
      message: 'The referrer is an owner of this wedding.',
    });
  if (error instanceof ReferrerNotActiveError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFERRER_NOT_ACTIVE',
      message: 'The referrer is not active.',
    });
  if (error instanceof GuestNotFoundForErasureError)
    return new NotFoundException({
      statusCode: 404,
      error: 'GUEST_NOT_FOUND',
      message: 'Guest not found.',
    });
  if (error instanceof ChecksRequiredError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'CHECKS_REQUIRED',
      message: 'Confirm the three checks with the couple.',
    });
  if (error instanceof ChecksFailedError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'CHECKS_FAILED',
      message: 'The checks did not match.',
    });
  if (error instanceof EmailInUseError)
    return new ConflictException({
      statusCode: 409,
      error: 'EMAIL_IN_USE',
      message: 'This e-mail belongs to another Kore account.',
    });
  if (error instanceof AccessChangeRateLimitedError)
    return new HttpException(
      {
        statusCode: 429,
        error: 'RATE_LIMITED',
        message: 'Daily limit of access e-mail changes reached. Ask the Admin.',
        retryAt: error.retryAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  if (error instanceof AccessEmailLockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'ACCESS_EMAIL_LOCKED',
      message: 'Too many failed checks for this wedding. Ask the Admin.',
      availableAt: error.availableAt.toISOString(),
    });
  if (error instanceof AdminOnlyError || error instanceof NotAnOwnerError)
    return new ForbiddenException({
      statusCode: 403,
      error: 'ACTION_NOT_ALLOWED',
      message:
        error instanceof AdminOnlyError
          ? 'Only the Admin can do this. Ask the Admin.'
          : 'Only an owner of the wedding can have the access e-mail changed.',
    });
  if (error instanceof NotLockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_LOCKED',
      message: 'The access e-mail change is not locked for this wedding.',
    });
  if (error instanceof UnlockTooSoonError)
    return new ConflictException({
      statusCode: 409,
      error: 'UNLOCK_TOO_SOON',
      message: 'The lock was already released in the last 24 hours.',
      availableAt: error.availableAt.toISOString(),
    });
  if (error instanceof NoOwnerError)
    return new ConflictException({
      statusCode: 409,
      error: 'NO_OWNER',
      message: 'The couple has not accepted the invitation yet.',
    });
  if (error instanceof SupportSessionNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'SUPPORT_SESSION_NOT_FOUND',
      message: 'Support session not found.',
    });
  return error;
}
