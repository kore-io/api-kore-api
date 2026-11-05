import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { REDIS_CLIENT } from '../../src/shared/redis/redis.module';
import { createTestApp } from '../support/create-test-app';

describe('GET /health', () => {
  describe('com Postgres e Redis no ar', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('dados Postgres e Redis no ar, quando pede o health, então responde 200 com os dois up', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' }, redis: { status: 'up' } },
      });
    });

    it('dado o health de infraestrutura, quando pede sob /v1, então não existe (decisão 97)', async () => {
      await request(app.getHttpServer()).get('/v1/health').expect(404);
    });
  });

  describe('com o Redis fora do ar', () => {
    let app: INestApplication;
    // Cliente que falha como o ioredis com o servidor fora do ar.
    const refused = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:6399'));
    const offlineRedis = { connect: refused, ping: refused, disconnect: () => undefined };

    beforeAll(async () => {
      app = await createTestApp({
        override: (builder) => builder.overrideProvider(REDIS_CLIENT).useValue(offlineRedis),
      });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('dado o Redis fora do ar, quando pede o health, então responde 200 com o Redis down no corpo, sem expor o erro (decisões 97 e 134)', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: { redis: { status: 'down', message: 'unreachable' } },
      });
      expect(JSON.stringify(response.body)).not.toContain('6399');
    });
  });
});

describe('GET /health com o Postgres fora do ar', () => {
  let app: INestApplication;
  const refused = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5499'));

  beforeAll(async () => {
    app = await createTestApp({
      override: (builder) =>
        builder
          .overrideProvider(PrismaService)
          .useValue({ $queryRaw: refused, $disconnect: () => Promise.resolve() }),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dado o Postgres fora do ar, quando pede o health, então responde 503 com o Redis no corpo e sem expor o erro', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(503);

    expect(response.body).toMatchObject({
      status: 'error',
      info: { redis: { status: 'up' } },
      error: { database: { status: 'down', message: 'unreachable' } },
    });
    expect(JSON.stringify(response.body)).not.toContain('5499');
  });
});
