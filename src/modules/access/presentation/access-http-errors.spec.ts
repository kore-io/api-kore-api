import { HttpException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  InvalidLoginCodeError,
  LoginChallengeExpiredError,
  LoginChallengeLockedError,
  LoginRequestLimitError,
  LoginRequestTooSoonError,
  SessionExpiredError,
  UserBlockedError,
} from '../domain/access.errors';
import { toHttpError } from './access-http-errors';

interface Schema {
  properties: Record<string, { enum?: unknown[] }>;
  required?: string[];
}

// O openapi.json versionado (decisão 149): o corpo real de cada erro tem de
// bater com o schema documentado, que é o que o Orval tipa no app.
const schemas = (
  JSON.parse(readFileSync(resolve(__dirname, '../../../../openapi.json'), 'utf8')) as {
    components: { schemas: Record<string, Schema> };
  }
).components.schemas;

function documentedSchemaFor({ error }: { error: string }): Schema {
  const found = Object.values(schemas).find(
    (schema) => schema.properties.error?.enum?.[0] === error,
  );
  if (!found) throw new Error(`Erro ${error} não documentado no openapi.json.`);
  return found;
}

describe('Erros do contexto Acesso × openapi.json (decisões 99, 149 e 150)', () => {
  it.each([
    new SessionExpiredError(),
    new LoginRequestTooSoonError({ resendAvailableAt: new Date('2026-11-06T12:01:00.000Z') }),
    new LoginRequestLimitError({ retryAfterMinutes: 23 }),
    new InvalidLoginCodeError({ attemptsLeft: 4 }),
    new LoginChallengeExpiredError(),
    new LoginChallengeLockedError({ newCodeSent: true }),
    new LoginChallengeLockedError({ newCodeSent: false, retryAfterMinutes: 10 }),
    new UserBlockedError(),
  ])(
    'dado %s, quando vira resposta HTTP, então o corpo bate com o schema documentado',
    (domainError) => {
      const http = toHttpError(domainError) as HttpException;
      const body = http.getResponse() as Record<string, unknown>;
      const schema = documentedSchemaFor({ error: body.error as string });

      expect(http.getStatus()).toBe(body.statusCode);
      expect(schema.properties.statusCode.enum).toEqual([body.statusCode]);
      expect(Object.keys(body).every((key) => key in schema.properties)).toBe(true);
      expect((schema.required ?? []).every((key) => key in body)).toBe(true);
    },
  );
});
