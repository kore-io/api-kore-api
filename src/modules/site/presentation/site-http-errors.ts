import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import {
  SiteImageInvalidError,
  SiteImageLimitReachedError,
  SiteImageNotFoundError,
  SiteImageProcessingError,
  SiteImageUploadMissingError,
} from '../domain/site.errors';

/**
 * Erros do contexto Site para HTTP. Os da autorização central (404
 * WEDDING_NOT_FOUND e 403 ACTION_NOT_ALLOWED) seguem o mapa do Acesso.
 */
export function toHttpError(error: unknown): unknown {
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
