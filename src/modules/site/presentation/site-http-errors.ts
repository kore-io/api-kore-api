import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { validationError } from '../../../shared/http/validation-errors';
import {
  PartyLinkRateLimitedError,
  SiteLinkInvalidError,
  SiteDraftError,
  SiteNotFoundError,
  ContrastTooLowError,
  SiteImageInvalidError,
  SiteImageLimitReachedError,
  SiteImageNotFoundError,
  SiteImageProcessingError,
  SiteImageUploadMissingError,
  SiteFieldNotAllowedError,
  SiteFieldsInvalidError,
  SiteSlugLockedError,
  SiteSlugUnavailableError,
} from '../domain/site.errors';

/**
 * Erros do contexto Site para HTTP. Os da autorização central (404
 * WEDDING_NOT_FOUND e 403 ACTION_NOT_ALLOWED) seguem o mapa do Acesso.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof SiteLinkInvalidError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'LINK_INVALID',
      message: 'This link no longer works.',
    });
  }
  if (error instanceof PartyLinkRateLimitedError) {
    return new HttpException(
      { statusCode: 429, error: 'RATE_LIMITED', message: 'Too many requests.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  if (error instanceof SiteNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'SITE_NOT_FOUND',
      message: 'Site not found.',
    });
  }
  if (error instanceof SiteDraftError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'SITE_DRAFT',
      message: 'The site is not published yet.',
    });
  }
  if (error instanceof SiteFieldsInvalidError) return validationError({ errors: error.issues });
  if (error instanceof ContrastTooLowError) {
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'CONTRAST_TOO_LOW',
      message: 'The color does not reach the minimum contrast.',
      check: error.check,
      ratio: error.ratio,
    });
  }
  if (error instanceof SiteFieldNotAllowedError) {
    return new ForbiddenException({
      statusCode: 403,
      error: 'FIELD_NOT_ALLOWED',
      message: 'Only the couple can change these fields.',
      fields: error.fields,
    });
  }
  if (error instanceof SiteSlugLockedError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SLUG_LOCKED',
      message: 'The site is published; its address no longer changes.',
    });
  }
  if (error instanceof SiteSlugUnavailableError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SLUG_UNAVAILABLE',
      message: 'Wedding address taken or reserved.',
      reason: error.reason,
      suggestion: error.suggestion,
    });
  }
  if (error instanceof SiteImageLimitReachedError) {
    return new ConflictException({
      statusCode: 409,
      error: 'SITE_IMAGE_LIMIT',
      message: 'The wedding already has the maximum number of stored site images.',
    });
  }
  if (error instanceof SiteImageNotFoundError) {
    return new NotFoundException({
      statusCode: 404,
      error: 'IMAGE_NOT_FOUND',
      message: 'Image not found.',
      ...(error.imageIds && { imageIds: error.imageIds }),
    });
  }
  if (error instanceof SiteImageProcessingError) {
    return new ConflictException({
      statusCode: 409,
      error: 'IMAGE_PROCESSING',
      message: 'The image is being processed.',
    });
  }
  if (error instanceof SiteImageUploadMissingError) {
    return new ConflictException({
      statusCode: 409,
      error: 'UPLOAD_MISSING',
      message: 'The file did not reach the storage.',
    });
  }
  if (error instanceof SiteImageInvalidError) {
    return new UnprocessableEntityException({
      statusCode: 422,
      error: 'IMAGE_INVALID',
      message: 'The file is not a usable JPEG or PNG image.',
    });
  }
  return toAccessHttpError(error);
}
