import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
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
  PaymentAlreadyPaidError,
  PaymentGatewayUnavailableError,
  PaymentPendingError,
  PriceChangedError,
  RefundInProgressError,
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
  return toAccessHttpError(error);
}
