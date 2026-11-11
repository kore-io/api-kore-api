import type { OpenAPIObject } from '@nestjs/swagger';
import { TEMPLATE_HEADERS } from './modules/guests/domain/spreadsheet-import';

type Schemas = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>;

/**
 * Constantes do domínio publicadas no OpenAPI como schemas próprios, sem rota:
 * o web compara as suas cópias com o openapi.json e falha se divergirem.
 */
export const OPENAPI_CONSTANT_SCHEMAS: Schemas = {
  /** Os 7 títulos do modelo de planilha, nesta ordem (Importação RN02 e RN03; decisão 184, item 1). */
  SpreadsheetTemplateHeaders: {
    type: 'string',
    enum: [...TEMPLATE_HEADERS],
    description:
      'Os 7 títulos da primeira linha do modelo de planilha, na ordem das colunas (Importação RN02 e RN03).',
  },
};
