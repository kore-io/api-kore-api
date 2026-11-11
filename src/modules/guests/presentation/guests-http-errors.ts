import { NotFoundException } from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { validationError } from '../../../shared/http/validation-errors';
import { GuestFieldsInvalidError, PartyNotFoundError } from '../domain/guests.errors';

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
  return toAccessHttpError(error);
}
