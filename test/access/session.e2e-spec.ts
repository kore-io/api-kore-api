import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';
import { openSession, signedInUser } from '../support/sessions';

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_ORIGIN = 'http://localhost:5173';

describe('Sessão (Login sem senha e sessão)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const me = (cookie?: string) => {
    const call = request(app.getHttpServer()).get('/v1/me');
    return cookie ? call.set('Cookie', cookie) : call;
  };

  describe('GET /v1/me', () => {
    it('dada uma sessão aberta, quando pede /me, então devolve quem está conectado e a hora do login', async () => {
      const { userId, email, cookie } = await signedInUser({ app });

      const response = await me(cookie).expect(200);

      expect(response.body).toEqual({
        user: { id: userId, name: 'Ana Beatriz Moreira', email, platformRole: 'none' },
        memberships: [],
        planner: null,
        profiles: [],
        activeProfile: null,
        lastProfileOnDevice: null,
        referrer: null,
        authenticatedAt: expect.any(String),
      });
    });

    it('RN10 - dada uma requisição sem cookie, quando pede /me, então responde 401 SESSION_EXPIRED', async () => {
      const response = await me().expect(401);

      expect(response.body).toMatchObject({ statusCode: 401, error: 'SESSION_EXPIRED' });
    });
  });

  describe('RN08 - a sessão dura 7 dias a partir do último uso', () => {
    it('dado que entrei há 6 dias e usei o app, quando volto, então continuo conectado e a sessão vai a 7 dias de hoje', async () => {
      const { userId, cookie } = await signedInUser({ app });
      const sixDaysAgo = new Date(Date.now() - 6 * DAY_MS);
      await prisma.session.updateMany({
        where: { userId },
        data: {
          lastSeenAt: sixDaysAgo,
          authenticatedAt: sixDaysAgo,
          expiresAt: new Date(Date.now() + DAY_MS),
        },
      });

      const response = await me(cookie).expect(200);

      const [session] = await prisma.session.findMany({ where: { userId } });
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * DAY_MS);
      expect(response.headers['set-cookie']?.[0]).toMatch(
        /kore_session=.*HttpOnly.*Secure.*SameSite=Lax/,
      );
    });

    it('dado que usei o app pela última vez há 8 dias, quando abro o app, então a sessão terminou', async () => {
      const { userId, cookie } = await signedInUser({ app });
      await prisma.session.updateMany({
        where: { userId },
        data: {
          lastSeenAt: new Date(Date.now() - 8 * DAY_MS),
          expiresAt: new Date(Date.now() - DAY_MS),
        },
      });

      const response = await me(cookie).expect(401);

      expect(response.body.error).toBe('SESSION_EXPIRED');
      expect(response.headers['set-cookie']?.[0]).toMatch(/kore_session=;/);
    });
  });

  describe('RN09 - sair', () => {
    it('dado que estou conectado no celular e no computador, quando saio no celular, então só o celular sai', async () => {
      const { userId, cookie: phone } = await signedInUser({ app });
      const computer = await openSession({ app, userId });

      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Cookie', phone)
        .set('Origin', APP_ORIGIN)
        .expect(204);

      await me(phone).expect(401);
      await me(computer).expect(200);
    });

    it('dado que estou conectado no celular e no computador, quando saio de todos os aparelhos, então os dois saem', async () => {
      const { userId, cookie: computer } = await signedInUser({ app });
      const phone = await openSession({ app, userId });

      const response = await request(app.getHttpServer())
        .post('/v1/auth/logout-all')
        .set('Cookie', computer)
        .set('Origin', APP_ORIGIN)
        .expect(204);

      expect(response.headers['set-cookie']?.[0]).toMatch(/kore_session=;/);
      await me(computer).expect(401);
      await me(phone).expect(401);
    });

    it('dado que já não há sessão, quando sai, então responde 401', async () => {
      await request(app.getHttpServer()).post('/v1/auth/logout').expect(401);
    });
  });

  describe('RN11 - usuário bloqueado não entra', () => {
    it('dado um usuário bloqueado com uma sessão ainda aberta, quando usa o app, então a sessão é encerrada', async () => {
      const { userId, cookie } = await signedInUser({ app });
      await prisma.user.update({ where: { id: userId }, data: { status: 'blocked' } });

      await me(cookie).expect(401);

      const [session] = await prisma.session.findMany({ where: { userId } });
      expect(session.revokedAt).not.toBeNull();
    });
  });

  describe('rotas públicas', () => {
    it('dado o health check, quando chamado sem sessão, então responde', async () => {
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });
});
