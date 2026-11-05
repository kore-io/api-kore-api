import { Controller, INestApplication, Post } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import request from 'supertest';
import { Public } from '../src/shared/http/public.decorator';
import { AuthRateLimit } from '../src/shared/rate-limit/rate-limits';
import { REDIS_CLIENT } from '../src/shared/redis/redis.module';
import { createTestApp } from './support/create-test-app';

// Rotas só do teste: as rotas de auth reais entram na 59-login-email.
@Controller('test-auth')
@Public()
@AuthRateLimit()
class TestAuthController {
  @Post('a')
  a(): void {}

  @Post('b')
  b(): void {}
}

// IP de teste próprio para cada caso (X-Forwarded-For com TRUST_PROXY_HOPS=1).
const uniqueIp = () => `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;

describe('Rate limit por IP (ADR do rate limit; decisão 135)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [TestAuthController] });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dadas 10 chamadas às rotas de auth no minuto, quando chega a 11ª (em outra rota de auth), então responde 429', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post(i % 2 ? '/v1/test-auth/a' : '/v1/test-auth/b')
        .set('X-Forwarded-For', ip)
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .post('/v1/test-auth/a')
      .set('X-Forwarded-For', ip)
      .expect(429);

    expect(response.body).toEqual({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many requests.',
    });
  });

  it('dado um IP no limite de auth, quando outro IP chama, então ele não é afetado', async () => {
    const blocked = uniqueIp();
    for (let i = 0; i < 11; i++) {
      await request(app.getHttpServer()).post('/v1/test-auth/a').set('X-Forwarded-For', blocked);
    }

    await request(app.getHttpServer())
      .post('/v1/test-auth/a')
      .set('X-Forwarded-For', uniqueIp())
      .expect(201);
  });

  it('dado o limite geral do ambiente, quando um IP passa dele em rotas comuns, então responde 429', async () => {
    const ip = uniqueIp();
    const limit = Number(process.env.RATE_LIMIT_GENERAL_PER_MINUTE);
    const calls = Array.from({ length: limit }, () =>
      request(app.getHttpServer()).get('/v1/me').set('X-Forwarded-For', ip),
    );
    const statuses = (await Promise.all(calls)).map((response) => response.status);
    expect(statuses.every((status) => status === 401)).toBe(true);

    await request(app.getHttpServer()).get('/v1/me').set('X-Forwarded-For', ip).expect(429);
  });

  it('dada uma escrita de outra origem acima do limite de auth, quando chega, então o rate limit responde antes do CSRF (429)', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 10; i++) {
      await request(app.getHttpServer())
        .post('/v1/test-auth/a')
        .set('X-Forwarded-For', ip)
        .set('Origin', 'https://evil.example')
        .set('Cookie', 'kore_session=qualquer')
        .expect(403);
    }

    await request(app.getHttpServer())
      .post('/v1/test-auth/a')
      .set('X-Forwarded-For', ip)
      .set('Origin', 'https://evil.example')
      .set('Cookie', 'kore_session=qualquer')
      .expect(429);
  });

  it('dado o health check, quando chamado muitas vezes, então não entra no rate limit', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 12; i++) {
      await request(app.getHttpServer()).get('/health').set('X-Forwarded-For', ip).expect(200);
    }
  });
});

describe('Rate limit com o Redis fora do ar (decisão 97, item 3)', () => {
  let app: INestApplication;
  const refused = () => Promise.reject(new Error('connect ECONNREFUSED'));

  beforeAll(async () => {
    app = await createTestApp({
      controllers: [TestAuthController],
      override: (builder) =>
        builder.overrideProvider(REDIS_CLIENT).useValue({
          connect: refused,
          ping: refused,
          eval: refused,
          disconnect: () => undefined,
        }),
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dado o Redis fora do ar, quando um IP passa do limite de auth, então as requisições passam', async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 12; i++) {
      await request(app.getHttpServer())
        .post('/v1/test-auth/a')
        .set('X-Forwarded-For', ip)
        .expect(201);
    }
  });
});
