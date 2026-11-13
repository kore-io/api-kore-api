import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { validationError } from '../../../shared/http/validation-errors';
import { toHttpError as toSiteHttpError } from '../../site/presentation/site-http-errors';
import {
  NoSongsToExportError,
  SongCursorInvalidError,
  SongQuestionDisabledError,
  DeliveriesClosedError,
  DeliveryNotAllowedError,
  DeliveryPartyNotFoundError,
  LinkPlaceholderMissingError,
  DeadlineAfterEventError,
  DeadlineInPastError,
  ResponseGuestNotFoundError,
  PartySessionInvalidError,
  PreviewReadOnlyError,
  RsvpChangedError,
  RsvpClosedError,
  RsvpInvalidError,
  RsvpLimitError,
  RsvpRateLimitedError,
  RsvpSiteNotLiveError,
} from '../domain/rsvp.errors';

/** Erros do RSVP para HTTP; os do endereço (SITE_NOT_FOUND, SITE_DRAFT) seguem o mapa do Site. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof SongQuestionDisabledError)
    return new NotFoundException({
      statusCode: 404,
      error: 'SONG_QUESTION_DISABLED',
      message: 'The song question is turned off.',
    });
  if (error instanceof NoSongsToExportError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOTHING_TO_EXPORT',
      message: 'There are no song suggestions to export.',
    });
  if (error instanceof SongCursorInvalidError)
    return validationError({ errors: [{ path: 'cursor', code: 'INVALID_CURSOR', params: {} }] });
  // Data de saída do ar RN07: o expirado tem código próprio, com o texto da tela.
  if (error instanceof DeliveriesClosedError && error.reason === 'site_expired')
    return new ConflictException({
      statusCode: 409,
      error: 'SITE_EXPIRED',
      message: 'The site is expired. Renew it to send.',
    });
  if (error instanceof DeliveriesClosedError)
    return new ConflictException({
      statusCode: 409,
      error: 'DELIVERIES_CLOSED',
      message: 'Deliveries are not available now.',
      reason: error.reason,
    });
  if (error instanceof DeliveryPartyNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'PARTY_NOT_FOUND',
      message: 'Party not found.',
      partyIds: error.partyIds,
    });
  if (error instanceof DeliveryNotAllowedError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: error.code,
      message: 'This delivery is not allowed.',
      partyIds: error.partyIds,
    });
  if (error instanceof LinkPlaceholderMissingError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'LINK_PLACEHOLDER_MISSING',
      message: 'The message needs the {link} placeholder.',
    });
  if (error instanceof DeadlineInPastError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'DEADLINE_IN_PAST',
      message: 'The deadline is in the past.',
    });
  if (error instanceof DeadlineAfterEventError)
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'DEADLINE_AFTER_EVENT',
      message: 'The deadline must be up to the wedding day.',
      eventDate: error.eventDate,
    });
  if (error instanceof ResponseGuestNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'GUEST_NOT_FOUND',
      message: 'Guest not found.',
    });
  // Data de saída do ar RN07 e RN08: o RSVP fecha no site fora do ar; nada é gravado.
  if (error instanceof RsvpSiteNotLiveError)
    return error.state === 'expired'
      ? new ConflictException({
          statusCode: 409,
          error: 'SITE_EXPIRED',
          message: 'The site is expired. Answers are closed.',
        })
      : new HttpException(
          { statusCode: 423, error: 'SITE_UNAVAILABLE', message: 'This site is unavailable.' },
          423,
        );
  if (error instanceof PartySessionInvalidError)
    return new UnauthorizedException({
      statusCode: 401,
      error: 'PARTY_SESSION_INVALID',
      message: 'This link no longer works.',
    });
  if (error instanceof PreviewReadOnlyError)
    return new ForbiddenException({
      statusCode: 403,
      error: 'PREVIEW_READ_ONLY',
      message: 'Answers are not sent from the preview.',
    });
  if (error instanceof RsvpInvalidError) return validationError({ errors: error.issues });
  if (error instanceof RsvpChangedError)
    return new ConflictException({
      statusCode: 409,
      error: 'RSVP_CHANGED',
      message: 'The answers of this party changed.',
      current: error.current as unknown,
    });
  if (error instanceof RsvpClosedError)
    return new ConflictException({
      statusCode: 409,
      error: 'RSVP_CLOSED',
      message: 'Answers are closed.',
      reason: error.reason,
    });
  if (error instanceof RsvpRateLimitedError)
    return new HttpException(
      { statusCode: 429, error: 'RSVP_RATE_LIMITED', message: 'Too many requests.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  if (error instanceof RsvpLimitError)
    return new HttpException(
      { statusCode: 429, error: 'RSVP_LIMIT', message: 'Too many changes today.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  return toSiteHttpError(error);
}
