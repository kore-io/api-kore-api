import { ConflictException, NotFoundException } from '@nestjs/common';
import { validationError } from '@/shared/http/validation-errors';
import { toHttpError as toAccessHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import {
  TemplateInvalidError,
  TemplateNotFoundError,
  TemplatesLimitError,
} from '@/modules/planner/domain/planner-template';

/** Os erros da Área do cerimonialista; o resto, como no módulo de acesso. */
export function toPlannerHttpError(error: unknown): unknown {
  if (error instanceof TemplateNotFoundError)
    return new NotFoundException({
      statusCode: 404,
      error: 'TEMPLATE_NOT_FOUND',
      message: 'Template not found.',
    });
  if (error instanceof TemplatesLimitError)
    return new ConflictException({
      statusCode: 409,
      error: 'TEMPLATES_LIMIT',
      message: 'Too many templates.',
    });
  if (error instanceof TemplateInvalidError) return validationError({ errors: error.issues });
  return toAccessHttpError(error);
}
