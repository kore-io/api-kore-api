import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  AdminWeddingNotFoundError,
  AlreadyBlockedError,
  NotBlockedError,
} from '../domain/backoffice.errors';

/** Erros do Backoffice para HTTP. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof AdminWeddingNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'WEDDING_NOT_FOUND',
      message: 'Wedding not found.',
    });
  if (error instanceof AlreadyBlockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'ALREADY_BLOCKED',
      message: 'The wedding is already blocked.',
    });
  if (error instanceof NotBlockedError)
    return new ConflictException({
      statusCode: 409,
      error: 'NOT_BLOCKED',
      message: 'The wedding is not blocked.',
    });
  return error;
}
