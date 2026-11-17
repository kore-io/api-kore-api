import type { OpenAPIObject } from '@nestjs/swagger';
type SchemaObject = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];

/**
 * As escritas liberadas com o casamento bloqueado (Casamento bloqueado RN03),
 * as mesmas do `@AllowWhenBlocked()`: a pré-visualização é leitura. Sair do
 * casamento (DELETE …/memberships/{id}) passa pelo guard, mas o caso de uso
 * recusa a remoção de outra pessoa, então ela fica documentada.
 */
const ALLOWED_WHEN_BLOCKED = new Set(['post /v1/weddings/{weddingId}/site-previews']);
const WRITE_METHODS = ['post', 'put', 'patch', 'delete'] as const;

/** Os mesmos nomes dos DTOs da cobrança (o mesmo formato): um schema só por erro. */
const SCHEMAS: Record<string, SchemaObject> = {
  WeddingBlockedErrorBody: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', enum: [403] },
      error: { type: 'string', enum: ['WEDDING_BLOCKED'] },
      message: { type: 'string' },
    },
    required: ['statusCode', 'error', 'message'],
  },
  // Ver como o casal (Backoffice - acesso RN08): a escrita na sessão de suporte.
  SupportReadOnlyErrorBody: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', enum: [403] },
      error: { type: 'string', enum: ['SUPPORT_READ_ONLY'] },
      message: { type: 'string' },
    },
    required: ['statusCode', 'error', 'message'],
  },
  // A sessão de suporte que acabou: o Toast diz qual (30 minutos sem uso ou o limite de 2 horas).
  SupportSessionEndedErrorBody: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', enum: [403] },
      error: { type: 'string', enum: ['SUPPORT_SESSION_ENDED'] },
      message: { type: 'string' },
      reason: { type: 'string', enum: ['idle', 'max_duration'] },
    },
    required: ['statusCode', 'error', 'message', 'reason'],
  },
  WeddingDeletionScheduledErrorBody: {
    type: 'object',
    properties: {
      statusCode: { type: 'number', enum: [409] },
      error: { type: 'string', enum: ['WEDDING_DELETION_SCHEDULED'] },
      message: { type: 'string' },
    },
    required: ['statusCode', 'error', 'message'],
  },
};

type Schema = { $ref?: string; oneOf?: { $ref: string }[] };
type Responses = Record<
  string,
  { description?: string; content?: Record<string, { schema?: Schema }> }
>;

function addError({
  responses,
  status,
  ref,
}: {
  responses: Responses;
  status: string;
  ref: string;
}) {
  const response = responses[status];
  const target = { $ref: ref };
  if (!response?.content?.['application/json']?.schema) {
    responses[status] = {
      description: response?.description ?? '',
      content: { 'application/json': { schema: target } },
    };
    return;
  }
  const json = response.content['application/json'];
  const schema = json.schema!;
  const refs = schema.oneOf ?? (schema.$ref ? [{ $ref: schema.$ref }] : []);
  if (refs.some((item) => item.$ref === ref)) return;
  json.schema = { oneOf: [...refs, target] };
}

/**
 * Toda rota de escrita com `{weddingId}` responde `403 WEDDING_BLOCKED` e `409
 * WEDDING_DELETION_SCHEDULED` (Casamento bloqueado RN02, "Contrato de API"),
 * pelo `WeddingWriteGuard`, e `403 SUPPORT_READ_ONLY` pelo `SupportSessionGuard`;
 * toda rota com `{weddingId}`, `403 SUPPORT_SESSION_ENDED` (Backoffice -
 * acesso RN08; decisão 275). Documentado aqui, num ponto só, com a mesma regra.
 */
export function addWeddingWriteErrors(document: OpenAPIObject): OpenAPIObject {
  document.components = {
    ...document.components,
    schemas: { ...document.components?.schemas, ...SCHEMAS },
  };
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.includes('{weddingId}')) continue;
    const operations = item as Record<string, { responses?: Responses } | undefined>;
    // Ver como o casal (RN08): toda rota do casal pode encontrar a sessão de
    // suporte encerrada; toda escrita, a sessão só de leitura.
    for (const method of ['get', ...WRITE_METHODS] as const) {
      const operation = operations[method];
      if (!operation) continue;
      const responses = (operation.responses ??= {});
      addError({
        responses,
        status: '403',
        ref: '#/components/schemas/SupportSessionEndedErrorBody',
      });
      if (method !== 'get')
        addError({
          responses,
          status: '403',
          ref: '#/components/schemas/SupportReadOnlyErrorBody',
        });
    }
    for (const method of WRITE_METHODS) {
      const operation = operations[method];
      if (!operation || ALLOWED_WHEN_BLOCKED.has(`${method} ${path}`)) continue;
      const responses = (operation.responses ??= {});
      addError({ responses, status: '403', ref: '#/components/schemas/WeddingBlockedErrorBody' });
      addError({
        responses,
        status: '409',
        ref: '#/components/schemas/WeddingDeletionScheduledErrorBody',
      });
    }
  }
  return document;
}
