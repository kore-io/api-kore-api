import { ConflictException } from '@nestjs/common';
import { toHttpError as toAccessHttpError } from '../../access/presentation/access-http-errors';
import { SiteImageLimitReachedError } from '../domain/site.errors';

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
  return toAccessHttpError(error);
}
