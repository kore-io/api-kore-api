import {
  ConflictException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validationError } from '../../../shared/http/validation-errors';
import { toHttpError } from '../../access/presentation/access-http-errors';
import { InvalidPayoutDataError } from '../application/payout-data.use-cases';
import {
  PayoutAmountChangedError,
  PayoutBelowMinimumError,
  PayoutDataMissingError,
  PayoutKeyReusedError,
  PayoutOpenError,
  PayoutsDisabledError,
  PayoutTooSoonError,
  PixKeyChangePendingError,
  PixKeyLinkExpiredError,
  PixKeyNotFoundError,
  TaxIdInUseError,
  TaxIdLockedError,
} from '../domain/referral.errors';

/** Os erros do indicador em HTTP; os de sessão e perfil, como no access. */
export function toReferralHttpError(error: unknown): unknown {
  if (error instanceof TaxIdLockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'TAX_ID_LOCKED',
      message: 'The tax id is already set; ask support to change it.',
    });
  if (error instanceof TaxIdInUseError)
    return new ConflictException({
      statusCode: 409,
      error: 'TAX_ID_IN_USE',
      message: 'This tax id belongs to another account.',
    });
  if (error instanceof PixKeyChangePendingError)
    return new ConflictException({
      statusCode: 409,
      error: 'PIX_KEY_CHANGE_PENDING',
      message: 'A Pix key change is pending.',
      activeFrom: error.activeFrom.toISOString(),
    });
  if (error instanceof PixKeyNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'PIX_KEY_NOT_FOUND',
      message: 'Pix key not found.',
    });
  if (error instanceof PixKeyLinkExpiredError)
    return new GoneException({
      statusCode: 410,
      error: 'PIX_KEY_LINK_EXPIRED',
      message: 'The confirmation link expired.',
    });
  if (error instanceof PayoutsDisabledError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUTS_DISABLED',
      message: 'Payouts are not open yet.',
    });
  if (error instanceof PayoutDataMissingError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_DATA_MISSING',
      message: 'Register the tax id and the Pix key first.',
    });
  if (error instanceof PayoutBelowMinimumError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_BELOW_MINIMUM',
      message: 'The balance is below the payout minimum.',
      balanceCents: error.balanceCents,
      minimumCents: error.minimumCents,
    });
  if (error instanceof PayoutTooSoonError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_TOO_SOON',
      message: 'One payout request every 30 days.',
      nextRequestAt: error.nextRequestAt.toISOString(),
    });
  if (error instanceof PayoutOpenError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_OPEN',
      message: 'A payout is still open.',
      payoutId: error.payoutId,
    });
  if (error instanceof PayoutAmountChangedError)
    return new ConflictException({
      statusCode: 409,
      error: 'PAYOUT_AMOUNT_CHANGED',
      message: 'The available balance changed.',
      amountCents: error.amountCents,
    });
  if (error instanceof PayoutKeyReusedError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was used with a different request.',
    });
  if (error instanceof InvalidPayoutDataError)
    return validationError({ errors: [{ path: 'body', code: 'INVALID_PAYOUT_DATA', params: {} }] });
  if (error instanceof HttpException) return error;
  return toHttpError(error);
}
