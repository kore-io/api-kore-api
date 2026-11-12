import type { OpenAPIObject } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_SLUG_LIST } from './modules/access/domain/wedding-signup';
import { TEMPLATE_HEADERS } from './modules/guests/domain/spreadsheet-import';

type Schemas = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>;

/**
 * O sha256 da fixture de contraste da Aparência (Aparência RN01), dos bytes do
 * arquivo: o web confere a cópia dele contra o openapi.json. Copiada para o
 * dist pelos assets do nest-cli.json.
 */
export function appearanceFixtureSha256(): string {
  const file = join(__dirname, 'modules/site/domain/appearance-contrast.fixture.json');
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

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
  /** Slugs reservados: rotas do Kore na raiz de kore.com.br (Dados básicos RN07; decisão 205, D19). */
  ReservedSlugs: {
    type: 'string',
    enum: [...RESERVED_SLUG_LIST],
    description:
      'Endereços que nenhum casamento pode usar, porque são rotas do Kore na raiz de kore.com.br. A comparação não diferencia maiúsculas de minúsculas (Dados básicos RN07).',
  },
  /** A fixture de contraste da Aparência, igual no app e na API (Aparência RN01). */
  AppearanceContrastFixtureSha256: {
    type: 'string',
    enum: [appearanceFixtureSha256()],
    description:
      'O sha256 (hex) da appearance-contrast.fixture.json da API. A cópia do web precisa ter o mesmo (Aparência RN01).',
  },
};
