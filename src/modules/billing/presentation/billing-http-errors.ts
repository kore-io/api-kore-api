import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import {
  BillingEndDateOutOfRangeError,
  BillingEventDateMissingError,
  BillingNotDraftError,
  BillingSlugMissingError,
  IdempotencyKeyReusedError,
  NotPublishedError,
  BillingWeddingBlockedError,
  EndDateBeyondPaidError,
  WeddingDeletionScheduledError,
  PaymentAlreadyPaidError,
  PaymentDisputedError,
  PaymentNotFoundError,
  PaymentNotPaidError,
  RefundAlreadyRequestedError,
  RefundNotLastExtensionError,
  RefundWindowClosedError,
  PaymentGatewayUnavailableError,
  PaymentPendingError,
  PriceChangedError,
  RefundInProgressError,
  ConfirmNameMismatchError,
  NoDeletionScheduledError,
  RefundWindowOpenError,
} from '../domain/billing.errors';
import { InstallmentsOutOfRangeError } from '../domain/pricing';

/**
 * Erros da cobrança para HTTP (Preço e cotação, Contrato de API), com os
 * mesmos códigos da Publicação por Cortesia. Os da autorização central (404
 * WEDDING_NOT_FOUND e 403 ACTION_NOT_ALLOWED) seguem o mapa do Acesso.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof BillingNotDraftError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_DRAFT',
      message: 'Only a draft wedding can be published.',
    });
  if (error instanceof NotPublishedError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_PUBLISHED',
      message: 'The wedding was never published.',
    });
  if (error instanceof BillingEventDateMissingError)
    return new ConflictException({
      statusCode: 409,
      error: 'EVENT_DATE_MISSING',
      message: 'The wedding needs a date and a state to be published.',
    });
  if (error instanceof BillingSlugMissingError)
    return new ConflictException({
      statusCode: 409,
      error: 'SITE_SLUG_MISSING',
      message: 'The wedding has no site address yet.',
    });
  if (error instanceof BillingEndDateOutOfRangeError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'END_DATE_OUT_OF_RANGE',
      message: 'The end date must be after the wedding and within 12 months of it.',
      endDateMin: error.endDateMin,
      endDateMax: error.endDateMax,
    });
  if (error instanceof InstallmentsOutOfRangeError)
    return new BadRequestException({
      statusCode: 400,
      error: 'INSTALLMENTS_OUT_OF_RANGE',
      message: 'The number of installments is not available for this amount.',
      maxInstallments: error.maxInstallments,
    });
  if (error instanceof PaymentPendingError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYMENT_PENDING',
      message: 'There is already a payment awaiting confirmation.',
    });
  if (error instanceof WeddingDeletionScheduledError)
    return new ConflictException({
      statusCode: 409,
      error: 'WEDDING_DELETION_SCHEDULED',
      message: 'The wedding deletion is scheduled.',
    });
  if (error instanceof EndDateBeyondPaidError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'END_DATE_BEYOND_PAID',
      message: 'The new date is after the paid period. Pay an extension for it.',
      paidThrough: error.paidThrough,
    });
  if (error instanceof PaymentNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'PAYMENT_NOT_FOUND',
      message: 'Payment not found.',
    });
  if (error instanceof BillingWeddingBlockedError)
    return new ForbiddenException({
      statusCode: 403,
      error: 'WEDDING_BLOCKED',
      message: 'The wedding is blocked.',
    });
  if (error instanceof PaymentNotPaidError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYMENT_NOT_PAID',
      message: 'Only a paid and applied payment can be refunded.',
    });
  if (error instanceof PaymentDisputedError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYMENT_DISPUTED',
      message: 'The payment is disputed.',
    });
  if (error instanceof RefundAlreadyRequestedError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFUND_ALREADY_REQUESTED',
      message: 'The refund of this payment was already requested.',
    });
  if (error instanceof RefundNotLastExtensionError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFUND_NOT_LAST_EXTENSION',
      message: 'There is a more recent extension.',
    });
  if (error instanceof RefundWindowClosedError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFUND_WINDOW_CLOSED',
      message: 'The 7-day refund window is over.',
      refundableUntil: error.refundableUntil?.toISOString() ?? null,
    });
  if (error instanceof PaymentAlreadyPaidError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYMENT_ALREADY_PAID',
      message: 'The payment being replaced was already paid.',
    });
  if (error instanceof RefundInProgressError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFUND_IN_PROGRESS',
      message: 'The previous publication is still being refunded.',
    });
  if (error instanceof PriceChangedError)
    return new ConflictException({
      statusCode: 409,
      error: 'PRICE_CHANGED',
      message: 'The price changed. Fetch the quote again.',
    });
  if (error instanceof IdempotencyKeyReusedError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was used with a different request.',
    });
  if (error instanceof PaymentGatewayUnavailableError)
    return new HttpException(
      {
        statusCode: 503,
        error: 'GATEWAY_UNAVAILABLE',
        message: 'The payment gateway did not answer. Try again with the same Idempotency-Key.',
        paymentId: error.paymentId,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  if (error instanceof ConfirmNameMismatchError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'CONFIRM_NAME_MISMATCH',
      message: 'Type the couple name to confirm.',
    });
  if (error instanceof RefundWindowOpenError)
    return new ConflictException({
      statusCode: 409,
      error: 'REFUND_WINDOW_OPEN',
      message: 'A payment can still be refunded. Refund it before deleting the wedding.',
      refundableUntil: error.refundableUntil.toISOString(),
    });
  if (error instanceof NoDeletionScheduledError)
    return new ConflictException({
      statusCode: 409,
      error: 'NO_DELETION_SCHEDULED',
      message: 'There is no deletion to cancel.',
    });
  return toAccessHttpError(error);
}
