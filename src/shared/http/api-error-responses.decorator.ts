import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import {
  OriginNotAllowedErrorBody,
  RateLimitedErrorBody,
  SessionExpiredErrorBody,
  ValidationErrorBody,
} from './api-error.dto';

type ErrorBody = Type<unknown> & { status: number };

/**
 * Documenta as respostas de erro de uma rota, agrupadas por status: quando um
 * status tem mais de um código (ex.: 429 TOO_SOON e RATE_LIMITED), o schema é
 * um oneOf, e o campo error distingue (decisão 149).
 */
export function ApiErrorResponses(...errors: ErrorBody[]): MethodDecorator & ClassDecorator {
  const byStatus = new Map<number, ErrorBody[]>();
  for (const error of errors)
    byStatus.set(error.status, [...(byStatus.get(error.status) ?? []), error]);
  return applyDecorators(
    ApiExtraModels(...errors),
    ...[...byStatus].map(([status, bodies]) =>
      ApiResponse({
        status,
        schema:
          bodies.length === 1
            ? { $ref: getSchemaPath(bodies[0]) }
            : { oneOf: bodies.map((body) => ({ $ref: getSchemaPath(body) })) },
      }),
    ),
  );
}

/**
 * Os erros transversais de uma rota: rate limit (toda rota), validação (com
 * corpo ou query), sessão (rota não pública) e origem (escrita, CSRF).
 */
export function commonErrors({
  validated = false,
  session = false,
  write = false,
}: {
  validated?: boolean;
  session?: boolean;
  write?: boolean;
}): ErrorBody[] {
  return [
    RateLimitedErrorBody,
    ...(validated ? [ValidationErrorBody] : []),
    ...(session ? [SessionExpiredErrorBody] : []),
    ...(write ? [OriginNotAllowedErrorBody] : []),
  ];
}
