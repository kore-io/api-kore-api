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

import {
  PayoutAmountMismatchError,
  PayoutBelowMinimumError,
  PayoutNotFoundError,
  PayoutPaymentsDisabledError,
  PayoutPixKeyChangePendingError,
  PayoutReferrerBlockedError,
  PayoutStatusConflictError,
  PayoutStillHeldError,
} from '../../billing/domain/payout.errors';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';

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
  if (error instanceof PayoutNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'PAYOUT_NOT_FOUND',
      message: 'Payout not found.',
    });
  if (error instanceof PayoutStatusConflictError && error.expected === 'requested')
    return error.status === 'held'
      ? new ConflictException({
          statusCode: 409,
          error: 'PAYOUT_HELD',
          message: 'The payout is held. Release or reject it.',
          status: error.status,
        })
      : new ConflictException({
          statusCode: 409,
          error: 'PAYOUT_NOT_REQUESTED',
          message: 'The payout is no longer requested.',
          status: error.status,
        });
  if (error instanceof PayoutStatusConflictError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_STATUS_CONFLICT',
      message: 'The payout is not in a state that allows this action.',
      status: error.status,
    });
  if (error instanceof PayoutPaymentsDisabledError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUTS_DISABLED',
      message: 'Payouts are disabled in this environment.',
    });
  if (error instanceof PayoutReferrerBlockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFERRER_BLOCKED',
      message: 'The referrer is blocked.',
    });
  if (error instanceof PayoutPixKeyChangePendingError)
    return new ConflictException({
      statusCode: 409,
      error: 'PIX_KEY_CHANGE_PENDING',
      message: 'A Pix key change is pending.',
    });
  if (error instanceof PayoutAmountMismatchError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_AMOUNT_MISMATCH',
      message: 'The payout amount does not match its commissions and adjustments.',
      amountCents: error.amountCents,
      itemsCents: error.itemsCents,
    });
  if (error instanceof PayoutBelowMinimumError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_BELOW_MINIMUM',
      message: 'Below the payout minimum after removing the reversed commissions. Reject it.',
      amountCents: error.amountCents,
      minimumCents: error.minimumCents,
    });
  if (error instanceof PayoutStillHeldError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_HELD',
      message: 'A commission of this payout is still being refunded or disputed.',
    });
  return toAccessHttpError(error);
}
