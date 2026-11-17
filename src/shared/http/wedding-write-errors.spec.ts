import type { OpenAPIObject } from '@nestjs/swagger';
import { addWeddingWriteErrors } from './wedding-write-errors';

const refsOf = (document: OpenAPIObject, path: string, method: string, status: string) => {
  const operation = (
    document.paths[path] as Record<string, { responses: Record<string, unknown> }>
  )[method];
  const schema = (
    operation.responses[status] as {
      content: { 'application/json': { schema: { $ref?: string; oneOf?: { $ref: string }[] } } };
    }
  ).content['application/json'].schema;
  return (schema.oneOf ?? [schema]).map((item) => item.$ref?.split('/').at(-1));
};

describe('addWeddingWriteErrors (Casamento bloqueado RN02; Backoffice - acesso RN08; decisão 275)', () => {
  const document = (): OpenAPIObject => ({
    openapi: '3.0.0',
    info: { title: 'Kore', version: '1' },
    paths: {
      '/v1/weddings/{weddingId}/parties': {
        get: { responses: { '200': { description: '' } } },
        post: {
          responses: {
            '403': {
              description: '',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ActionNotAllowedErrorBody' },
                },
              },
            },
          },
        },
      },
      '/v1/weddings/{weddingId}/site-previews': { post: { responses: {} } },
      '/v1/me': { get: { responses: {} }, post: { responses: {} } },
    },
  });

  it('RN08 - toda rota do casal lista o SUPPORT_SESSION_ENDED; toda escrita, também o SUPPORT_READ_ONLY, somados aos erros que já havia', () => {
    const result = addWeddingWriteErrors(document());
    expect(refsOf(result, '/v1/weddings/{weddingId}/parties', 'get', '403')).toEqual([
      'SupportSessionEndedErrorBody',
    ]);
    expect(refsOf(result, '/v1/weddings/{weddingId}/parties', 'post', '403')).toEqual([
      'ActionNotAllowedErrorBody',
      'SupportSessionEndedErrorBody',
      'SupportReadOnlyErrorBody',
      'WeddingBlockedErrorBody',
    ]);
    expect(result.components?.schemas?.SupportSessionEndedErrorBody).toMatchObject({
      properties: { reason: { enum: ['idle', 'max_duration'] } },
      required: expect.arrayContaining(['reason']),
    });
  });

  it('RN03 e RN08 - a Pré-visualização, liberada no bloqueio, ainda é escrita no Ver como o casal; fora das rotas do casal, nada muda', () => {
    const result = addWeddingWriteErrors(document());
    expect(refsOf(result, '/v1/weddings/{weddingId}/site-previews', 'post', '403')).toEqual([
      'SupportSessionEndedErrorBody',
      'SupportReadOnlyErrorBody',
    ]);
    expect((result.paths['/v1/me'] as { post: { responses: object } }).post.responses).toEqual({});
  });
});
