import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { validationError } from '../../../shared/http/validation-errors';
import { toHttpError as toSiteHttpError } from '../../site/presentation/site-http-errors';
import {
  PartySessionInvalidError,
  PreviewReadOnlyError,
  RsvpChangedError,
  RsvpClosedError,
  RsvpInvalidError,
  RsvpLimitError,
  RsvpRateLimitedError,
} from '../domain/rsvp.errors';

/** Erros do RSVP para HTTP; os do endereço (SITE_NOT_FOUND, SITE_DRAFT) seguem o mapa do Site. */
export function toHttpError(error: unknown): unknown {
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
