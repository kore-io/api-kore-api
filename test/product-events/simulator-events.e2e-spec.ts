import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import type { Env } from '../../src/shared/config/env.schema';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';

const SITE_ORIGIN = 'http://localhost:5174';

/** As métricas anônimas do Simule o site (Simule RN01 e RN11; banco real). */
describe('Métricas do simulador (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const ip = () => `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const send = (target: INestApplication, body: object, from = ip()) =>
    request(target.getHttpServer())
      .post('/v1/product-events/simulator')
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send(body);

  it('RN11 - grava o nome e nada mais: sem casamento, sem props; a sessão é ignorada; CORS da origem do site', async () => {
    const { cookie } = await signedInUser({ app });
    const since = new Date();

    const response = await send(app, { name: 'simule_nomes' }).set('Cookie', cookie).expect(204);

    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
    const events = await db.productEvent.findMany({
      where: { name: 'simule_nomes', createdAt: { gte: since } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ weddingRef: null, props: null });
  });

  it('RN11 - só os 5 nomes do funil; campo a mais é 400, e nada é gravado', async () => {
    const since = new Date();

    for (const name of [
      'simule_iniciado',
      'simule_nomes',
      'simule_pronto',
      'simule_outra_cor_aberta',
      'simule_outra_cor_desistiu',
    ])
      await send(app, { name }).expect(204);
    await send(app, { name: 'conta_criada' }).expect(400);
    await send(app, { name: 'simule_pronto', weddingId: 'x' }).expect(400);

    // Os 5 aceitos gravaram; o recusado e o com campo a mais, não.
    expect(
      await db.productEvent.count({
        where: { createdAt: { gte: since }, name: 'simule_pronto', weddingRef: null },
      }),
    ).toBe(1);
  });

  it('RN11 - simulator_event: 30 por minuto por IP; outro IP não é afetado', async () => {
    const crowded = ip();
    for (let i = 0; i < 30; i++) await send(app, { name: 'simule_iniciado' }, crowded).expect(204);

    const blocked = await send(app, { name: 'simule_iniciado' }, crowded).expect(429);

    expect(blocked.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
    await send(app, { name: 'simule_iniciado' }).expect(204);
  });

  it('RN01 - com SIMULATOR_ENABLED desligada (homologação e produção), 404, e nada é gravado', async () => {
    const disabled = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(AppConfigService).useFactory({
          inject: [ConfigService],
          factory: (config: ConfigService<Env, true>) => {
            const service = new AppConfigService(config);
            const get = service.get.bind(service);
            service.get = (({ key }: { key: keyof Env }) =>
              key === 'SIMULATOR_ENABLED' ? false : get({ key })) as typeof service.get;
            return service;
          },
        }),
    });
    const since = new Date();
    try {
      await send(disabled, { name: 'simule_pronto' }).expect(404);
      expect(
        await db.productEvent.count({
          where: { name: 'simule_pronto', createdAt: { gte: since } },
        }),
      ).toBe(0);
    } finally {
      await disabled.close();
    }
  });
});
