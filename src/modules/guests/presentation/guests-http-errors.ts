import { ConflictException, NotFoundException } from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { validationError } from '../../../shared/http/validation-errors';
import {
  EmptyPlusOneError,
  GuestFieldsInvalidError,
  GuestNotFoundError,
  LastGuestError,
  PartyNotFoundError,
  PlusOnesInUseError,
} from '../domain/guests.errors';

/**
 * Erros do contexto Convidados para HTTP. Os da autorização central (404
 * WEDDING_NOT_FOUND e 403 ACTION_NOT_ALLOWED) seguem o mapa do Acesso.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof GuestFieldsInvalidError) return validationError({ errors: error.issues });
  if (error instanceof PartyNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'PARTY_NOT_FOUND',
      message: 'Party not found.',
    });
  }
  if (error instanceof GuestNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'GUEST_NOT_FOUND',
      message: 'Guest not found.',
    });
  }
  if (error instanceof LastGuestError) {
    return new ConflictException({
      statusCode: 409,
      error: 'LAST_GUEST',
      message: 'The party needs at least one named guest.',
    });
  }
  if (error instanceof EmptyPlusOneError) {
    return new ConflictException({
      statusCode: 409,
      error: 'EMPTY_PLUS_ONE',
      message: 'An empty plus-one slot cannot be moved or trashed.',
    });
  }
  if (error instanceof PlusOnesInUseError) {
    return new ConflictException({
      statusCode: 409,
      error: 'PLUS_ONES_IN_USE',
      message: 'There are more filled or answered plus-ones than the slots asked.',
      inUse: error.inUse,
    });
  }
  return toAccessHttpError(error);
}
