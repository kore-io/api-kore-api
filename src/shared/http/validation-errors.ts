import { BadRequestException } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';

/**
 * Uma falha de validação para o app montar o texto (decisões 189, item 1, e
 * 190): o caminho do campo (`guests.1.phone`), o código e os parâmetros.
 */
export type FieldError = {
  path: string;
  code: string;
  params: Record<string, unknown>;
};

/**
 * Os parâmetros de cada regra do class-validator, pelo nome. A regra guarda os
 * limites numa lista posicional; o app precisa deles com nome para o i18n.
 */
const PARAM_NAMES: Record<string, readonly string[]> = {
  maxLength: ['max'],
  minLength: ['min'],
  isLength: ['min', 'max'],
  max: ['max'],
  min: ['min'],
  arrayMaxSize: ['max'],
  arrayMinSize: ['min'],
  isIn: ['values'],
  isNotIn: ['values'],
  maxDate: ['max'],
  minDate: ['min'],
};

/** `maxLength` → `MAX_LENGTH`; `isEmail` → `IS_EMAIL`. */
export function toErrorCode(rule: string): string {
  return rule.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Corpo do `400`: o formato nativo (`statusCode`, `error`, `message`) com
 * `errors` ao lado (Convenções, Formato de erro). É o mesmo para a validação
 * do DTO e para a do domínio (o telefone, no objeto de valor).
 */
export function validationError({
  errors,
  message,
}: {
  errors: readonly FieldError[];
  message?: string[];
}): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    message: message ?? errors.map((error) => `${error.path}: ${error.code}`),
    errors,
  });
}

/** `exceptionFactory` do `ValidationPipe` global (decisão 190). */
export function validationExceptionFactory(
  validationErrors: ValidationError[],
): BadRequestException {
  const message: string[] = [];
  const errors: FieldError[] = [];
  for (const { path, error } of flatten({ errors: validationErrors, parentPath: '' })) {
    for (const [rule, text] of Object.entries(error.constraints ?? {})) {
      message.push(text);
      errors.push({ path, code: toErrorCode(rule), params: paramsOf({ error, rule }) });
    }
  }
  return validationError({ errors, message });
}

function* flatten({
  errors,
  parentPath,
}: {
  errors: readonly ValidationError[];
  parentPath: string;
}): Generator<{ path: string; error: ValidationError }> {
  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    yield { path, error };
    if (error.children?.length) yield* flatten({ errors: error.children, parentPath: path });
  }
}

function paramsOf({
  error,
  rule,
}: {
  error: ValidationError;
  rule: string;
}): Record<string, unknown> {
  const names = PARAM_NAMES[rule];
  const target = error.target;
  if (!names || !target) return {};
  const metadata = getMetadataStorage()
    .getTargetValidationMetadatas(target.constructor, '', true, false)
    .find((item) => item.propertyName === error.property && item.name === rule);
  if (!metadata) return {};
  return Object.fromEntries(
    names.map((name, index) => [name, metadata.constraints?.[index]] as const),
  );
}
