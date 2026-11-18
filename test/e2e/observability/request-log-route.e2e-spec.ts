import type { INestApplication } from '@nestjs/common';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { buildLoggerParams } from '@/shared/observability/logger.options';
import { seedWedding } from '../support/factories/weddings';
import { createTestApp } from '../support/harness/create-test-app';
import { signedInUser } from '../support/harness/sessions';

interface RequestLine {
  reqId?: unknown;
  req?: { method?: string; route?: string };
  res?: { statusCode?: number };
  msg?: string;
}

/**
 * Decisão 285 e ADR de Observabilidade (item 5: "só saem IDs, rota, status,
 * duração e o tipo do erro"): o log de requisição grava o MOLDE da rota do
 * Nest, nunca a URL crua. Pedido real, com o pino e as opções do main num
 * stream do teste.
 */
describe('Log de requisição: a rota de verdade (decisão 285; pedido real; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const lines: string[] = [];
  const completed = () =>
    lines
      .map((line) => JSON.parse(line) as RequestLine)
      .filter((entry) => entry.res?.statusCode !== undefined);

  beforeAll(async () => {
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const params = buildLoggerParams({ appEnv: 'test', level: 'trace' });
    app = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PARAMS_PROVIDER_TOKEN)
          .useValue({ ...params, pinoHttp: [params.pinoHttp, stream] }),
    });
    app.useLogger(app.get(Logger));
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    lines.length = 0;
  });

  it('decisão 285 - o pedido atendido grava o molde da rota, sem o id da URL', async () => {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });

    await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/memberships`)
      .set('Cookie', ana.cookie)
      .expect(200);

    expect(completed()).toEqual([
      expect.objectContaining({
        reqId: expect.anything(),
        req: { method: 'GET', route: '/v1/weddings/:weddingId/memberships' },
        res: { statusCode: 200 },
      }),
    ]);
    expect(lines.join('\n')).not.toContain(weddingId);
  });

  it('decisão 285 - o pedido barrado pelo guard e o 404 do controller também gravam o molde, sem o slug', async () => {
    await request(app.getHttpServer())
      .get('/v1/weddings/019a0000-0000-7000-8000-000000000000/memberships')
      .expect(401);
    await request(app.getHttpServer()).get('/v1/sites/slug-que-nao-existe').expect(404);

    expect(completed().map((entry) => [entry.req, entry.res?.statusCode])).toEqual([
      [{ method: 'GET', route: '/v1/weddings/:weddingId/memberships' }, 401],
      [{ method: 'GET', route: '/v1/sites/:slug' }, 404],
    ]);
    const text = lines.join('\n');
    expect(text).not.toContain('slug-que-nao-existe');
    expect(text).not.toContain('019a0000-0000-7000-8000-000000000000');
  });

  it('decisão 285 - o pedido sem rota casada segue (unmatched), sem a URL', async () => {
    await request(app.getHttpServer())
      .get('/v1/caminho-secreto/abc?email=ana@kore.com.br')
      .expect(404);

    expect(completed()).toEqual([
      expect.objectContaining({
        req: { method: 'GET', route: '(unmatched)' },
        res: { statusCode: 404 },
      }),
    ]);
    const text = lines.join('\n');
    expect(text).not.toContain('caminho-secreto');
    expect(text).not.toContain('ana@kore.com.br');
  });
});
