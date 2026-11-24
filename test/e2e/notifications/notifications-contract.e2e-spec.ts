import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Schema = {
  required?: string[];
  properties: Record<string, { enum?: unknown[]; items?: { oneOf?: { $ref: string }[] } }>;
};

/**
 * O contrato publicado (openapi.json) do payload da central (decisões 275 e
 * 316(13)): um schema por formato de item, para o app não ter parser à parte.
 * O schema vem do plugin do Swagger no nest build, que o Jest não roda; o
 * openapi:check do CI garante que o arquivo gravado é o do código.
 */
describe('Central: o payload no contrato publicado (decisão 316(13))', () => {
  const schemas = (
    JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'openapi.json'), 'utf8')) as {
      components: { schemas: Record<string, Schema> };
    }
  ).components.schemas;

  it('decisão 316(13) - o payload é um oneOf com os 5 formatos de item', () => {
    const refs = schemas.NotificationResponse.properties.payload.items?.oneOf?.map(
      (item) => item.$ref,
    );
    expect(refs).toEqual(
      [
        'NotificationEntryResponse',
        'CoupleEntryResponse',
        'CommissionEntryResponse',
        'ReferrerReassignedEntryResponse',
        'BillingEntryResponse',
      ].map((name) => `#/components/schemas/${name}`),
    );
  });

  it('Comissões do indicador RN09 - a commission traz commissionId, amountCents, partnerNames e at', () => {
    expect(schemas.CommissionEntryResponse.required?.sort()).toEqual(
      ['amountCents', 'at', 'commissionId', 'partnerNames'].sort(),
    );
  });

  it('Backoffice - acesso RN07 - o referrer_reassigned traz partnerNames e direction lost ou gained', () => {
    const schema = schemas.ReferrerReassignedEntryResponse;
    expect(schema.required?.sort()).toEqual(['direction', 'partnerNames']);
    expect(schema.properties.direction.enum).toEqual(['lost', 'gained']);
  });

  it('Backoffice - cobrança RN06 - o billing aceita o kind courtesy', () => {
    expect(schemas.BillingEntryResponse.properties.kind.enum).toContain('courtesy');
  });
});
