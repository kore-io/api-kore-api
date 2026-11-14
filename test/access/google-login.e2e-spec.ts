import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';

const APP_URL = 'http://localhost:5173';
const uniqueIp = () => `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
const newEmail = () => `google.${randomUUID()}@kore.local`;
const cookieValue = (setCookie: string[] | undefined, name: string) =>
  setCookie?.find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0];

describe('Login pelo Google com o provedor de desenvolvimento (Login sem senha e sessão; decisão 147)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let backoffice: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    backoffice = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Faz a ida e a volta inteiras, como o navegador faria. */
  async function signInWithGoogle({
    email,
    query = {},
    verified = true,
    extraCallbackParams = {},
  }: {
    email: string;
    query?: Record<string, string>;
    verified?: boolean;
    extraCallbackParams?: Record<string, string>;
  }) {
    const ip = uniqueIp();
    const start = await request(app.getHttpServer())
      .get('/v1/auth/google')
      .query(query)
      .expect(302);
    const oauthCookie = cookieValue(
      start.headers['set-cookie'] as unknown as string[],
      'kore_oauth',
    );
    const devUrl = new URL(start.headers.location, 'http://api.local');
    expect(devUrl.pathname).toBe('/v1/auth/google/dev');

    const dev = await request(app.getHttpServer())
      .get('/v1/auth/google/dev')
      .query({ state: devUrl.searchParams.get('state'), email, verified: String(verified) })
      .expect(302);
    const callbackUrl = new URL(dev.headers.location, 'http://api.local/v1/auth/google/');

    return request(app.getHttpServer())
      .get('/v1/auth/google/callback')
      .query({ ...Object.fromEntries(callbackUrl.searchParams), ...extraCallbackParams })
      .set('Cookie', oauthCookie ?? '')
      .set('X-Forwarded-For', ip)
      .expect(302);
  }

  it('dado o início do login, quando vai ao Google, então guarda o state num cookie HttpOnly só das rotas do Google', async () => {
    const start = await request(app.getHttpServer()).get('/v1/auth/google').expect(302);

    const setCookie = (start.headers['set-cookie'] as unknown as string[])[0];
    expect(setCookie).toMatch(
      /^kore_oauth=.+; Max-Age=600; Path=\/v1\/auth\/google; .*HttpOnly; Secure; SameSite=Lax/,
    );
  });

  it('RN06 - dado um e-mail sem conta, quando volta do Google, então cria a conta, abre a sessão e leva ao passo do app', async () => {
    const email = newEmail();

    const response = await signInWithGoogle({
      email,
      query: { origin: 'referral', next: '/app/convidados' },
    });

    const location = new URL(response.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(`${APP_URL}/entrar/google`);
    expect(Object.fromEntries(location.searchParams)).toEqual({
      step: 'couple_signup',
      next: '/app/convidados',
    });
    const session = cookieValue(
      response.headers['set-cookie'] as unknown as string[],
      'kore_session',
    );
    const me = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Cookie', session ?? '')
      .expect(200);
    expect(me.body.user.email).toBe(email);
    const [event] = await backoffice.productEvent.findMany({
      where: { name: 'conta_criada', props: { equals: { origem: 'referral', metodo: 'google' } } },
      orderBy: { occurredAt: 'desc' },
      take: 1,
    });
    expect(event).toBeDefined();
  });

  it('dado o Google acrescentando parâmetros na volta (iss da RFC 9207 e outros), quando volta, então o login segue', async () => {
    const response = await signInWithGoogle({
      email: newEmail(),
      extraCallbackParams: {
        iss: 'https://accounts.google.com',
        scope: 'openid email',
        qualquer: 'x',
      },
    });

    expect(response.headers.location).toMatch(new RegExp(`^${APP_URL}/entrar/google\\?step=`));
  });

  it('dada uma falha do Google ao trocar o código, quando volta, então vai para Entrar com error=google_failed', async () => {
    const start = await request(app.getHttpServer()).get('/v1/auth/google').expect(302);
    const oauthCookie = cookieValue(
      start.headers['set-cookie'] as unknown as string[],
      'kore_oauth',
    );
    const state = new URL(start.headers.location, 'http://api.local').searchParams.get('state');

    const response = await request(app.getHttpServer())
      .get('/v1/auth/google/callback')
      .query({ code: 'codigo-que-nao-e-do-provedor', state })
      .set('Cookie', oauthCookie ?? '')
      .set('X-Forwarded-For', uniqueIp())
      .expect(302);

    expect(response.headers.location).toBe(`${APP_URL}/entrar?error=google_failed`);
  });

  it('Cenário: Google liga à conta que já existe (RN07)', async () => {
    const email = newEmail();
    const existing = await prisma.user.create({ data: { email } });
    await prisma.authIdentity.create({
      data: { userId: existing.id, provider: 'email', providerSubject: email },
    });

    await signInWithGoogle({ email });

    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const identities = await prisma.authIdentity.findMany({ where: { userId: existing.id } });
    expect(identities.map((identity) => identity.provider).sort()).toEqual(['email', 'google']);
    const [session] = await prisma.session.findMany({ where: { userId: existing.id } });
    expect(session.authMethod).toBe('google');
  });

  it('caso de borda - dado um e-mail não verificado no Google, quando volta, então vai para Entrar com error=google_unverified', async () => {
    const response = await signInWithGoogle({ email: newEmail(), verified: false });

    expect(response.headers.location).toBe(`${APP_URL}/entrar?error=google_unverified`);
    expect(
      cookieValue(response.headers['set-cookie'] as unknown as string[], 'kore_session'),
    ).toBeUndefined();
  });

  it('RN11 - dado um usuário bloqueado, quando volta do Google, então vai para Entrar com error=blocked', async () => {
    const email = newEmail();
    await prisma.user.create({ data: { email, status: 'blocked' } });

    const response = await signInWithGoogle({ email });

    expect(response.headers.location).toBe(`${APP_URL}/entrar?error=blocked`);
  });

  it('decisão 136 (7) - dada uma página de volta de outro site, quando volta do Google, então ela é ignorada', async () => {
    const response = await signInWithGoogle({
      email: newEmail(),
      query: { next: '//evil.example' },
    });

    const location = new URL(response.headers.location);
    expect(location.searchParams.has('next')).toBe(false);
  });

  it.each([
    ['sem o cookie da ida', { cookie: false, state: 'qualquer' }],
    ['com outro state', { cookie: true, state: 'forjado' }],
  ])(
    'dada uma volta %s, quando chega, então vai para Entrar sem abrir sessão',
    async (_, { cookie, state }) => {
      const start = await request(app.getHttpServer()).get('/v1/auth/google').expect(302);
      const oauthCookie = cookieValue(
        start.headers['set-cookie'] as unknown as string[],
        'kore_oauth',
      );

      const callback = request(app.getHttpServer())
        .get('/v1/auth/google/callback')
        .query({ code: 'x', state })
        .set('X-Forwarded-For', uniqueIp());
      const response = await (cookie ? callback.set('Cookie', oauthCookie ?? '') : callback).expect(
        302,
      );

      expect(response.headers.location).toBe(`${APP_URL}/entrar?error=google_failed`);
      expect(
        cookieValue(response.headers['set-cookie'] as unknown as string[], 'kore_session'),
      ).toBeUndefined();
    },
  );

  it('dado o formulário de desenvolvimento sem e-mail, quando abre, então mostra o campo de e-mail', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/auth/google/dev')
      .query({ state: 'x' })
      .expect(200);

    expect(response.text).toContain('name="email"');
  });

  it('Backoffice - acesso RN01 (B9-2) - o login pelo Google grava na sessão o hd verificado; o Gmail, sem hd, grava nulo', async () => {
    const staff = `renata.${randomUUID()}@kore.com.br`;
    const consumer = `ana.${randomUUID()}@gmail.com`;
    await signInWithGoogle({ email: staff });
    await signInWithGoogle({ email: consumer });
    const sessionOf = (email: string) =>
      backoffice.session.findFirstOrThrow({
        where: { user: { email } },
        select: { staffDomain: true, authMethod: true },
      });
    expect(await sessionOf(staff)).toEqual({ staffDomain: 'kore.com.br', authMethod: 'google' });
    expect(await sessionOf(consumer)).toEqual({ staffDomain: null, authMethod: 'google' });
  });
});
