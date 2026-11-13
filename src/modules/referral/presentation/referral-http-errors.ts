import { ConflictException, GoneException, HttpException, NotFoundException } from '@nestjs/common';
import { validationError } from '../../../shared/http/validation-errors';
import { toHttpError } from '../../access/presentation/access-http-errors';
import { InvalidPayoutDataError } from '../application/payout-data.use-cases';
import {
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
  if (error instanceof InvalidPayoutDataError)
    return validationError({ errors: [{ path: 'body', code: 'INVALID_PAYOUT_DATA', params: {} }] });
  if (error instanceof HttpException) return error;
  return toHttpError(error);
}
