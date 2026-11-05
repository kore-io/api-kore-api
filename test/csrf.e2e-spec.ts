import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support/create-test-app';
import { signedInUser } from './support/sessions';

const APP_ORIGIN = 'http://localhost:5173';

describe('Proteção contra CSRF nas escritas (OriginGuard)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  const logout = () => request(app.getHttpServer()).post('/v1/auth/logout');

  it('dada uma escrita com sessão vinda de outra origem, quando chega, então responde 403 e a sessão continua', async () => {
    const { cookie } = await signedInUser({ app });

    const response = await logout()
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);

    expect(response.body).toMatchObject({ statusCode: 403, error: 'ORIGIN_NOT_ALLOWED' });
    await request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie).expect(200);
  });

  it('dada uma escrita com sessão vinda do app, quando chega, então passa', async () => {
    const { cookie } = await signedInUser({ app });

    await logout().set('Cookie', cookie).set('Origin', APP_ORIGIN).expect(204);
  });

  it('dada uma escrita com sessão e sem Origin, quando chega, então responde 403', async () => {
    const { cookie } = await signedInUser({ app });

    await logout().set('Cookie', cookie).expect(403);
  });

  it('dada uma escrita sem Origin e sem sessão (cliente fora do navegador), quando chega, então segue para a autorização normal', async () => {
    await logout().expect(401);
  });

  it('dada uma leitura com sessão vinda de outra origem, quando chega, então não é barrada pelo guard', async () => {
    const { cookie } = await signedInUser({ app });

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(200);
  });
});
