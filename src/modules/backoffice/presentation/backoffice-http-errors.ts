import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AlreadyPaidError,
  ReassignPaymentPendingError,
  ReferrerNotActiveError,
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
  if (error instanceof ReferrerNotActiveError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFERRER_NOT_ACTIVE',
      message: 'The referrer is not active.',
    });
  return error;
}
