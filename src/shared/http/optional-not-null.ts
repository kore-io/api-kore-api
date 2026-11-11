import { ValidateIf } from 'class-validator';

/**
 * Campo opcional que não aceita null: ausente não é validado; null passa pelas
 * outras regras e é recusado com 400. O @IsOptional deixaria o null chegar ao
 * caso de uso (e a uma coluna NOT NULL, com 500).
 */
export function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_, value) => value !== undefined);
}
