import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { PrismaService } from '../../src/shared/database/prisma.service';
import { createTestApp } from '../support/create-test-app';
import { inbox, latestLoginEmail } from '../support/mailpit';

// Cada caso usa um IP próprio (X-Forwarded-For): o limite de auth é por IP.
const uniqueIp = () => `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
const newEmail = () => `pessoa.${randomUUID()}@kore.local`;

describe('Login sem senha por e-mail (Login sem senha e sessão)', () => {
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

  const requestCode = ({
    email,
    ip,
    origin,
    originRef,
  }: {
    email: string;
    ip: string;
    origin?: string;
    originRef?: string;
  }) =>
    request(app.getHttpServer())
      .post('/v1/auth/login-challenges')
      .set('X-Forwarded-For', ip)
      .send({ email, origin, originRef });

  const verify = ({ ip, body }: { ip: string; body: Record<string, unknown> }) =>
    request(app.getHttpServer())
      .post('/v1/auth/login-challenges/verify')
      .set('X-Forwarded-For', ip)
      .send(body);

  // Simula a passagem do tempo para o último pedido do e-mail.
  const ageLatestRequest = async ({ email, seconds }: { email: string; seconds: number }) => {
    const latest = await prisma.loginChallenge.findFirstOrThrow({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.loginChallenge.update({
      where: { id: latest.id },
      data: { createdAt: new Date(latest.createdAt.getTime() - seconds * 1000) },
    });
  };

  describe('Funcionalidade: Entrar sem senha', () => {
    it('Cenário: Entrar com o código do e-mail (RN01)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const { code, token, subject } = await latestLoginEmail({ to: email });

      const response = await verify({ ip, body: { email, code } }).expect(200);

      expect(subject).toBe('Seu código para entrar no Kore');
      expect(response.headers['set-cookie']?.[0]).toMatch(/kore_session=.+; .*HttpOnly/);
      const cookie = response.headers['set-cookie'][0].split(';')[0];
      await request(app.getHttpServer()).get('/v1/me').set('Cookie', cookie).expect(200);
      // E o botão de acesso do mesmo e-mail deixa de funcionar.
      await verify({ ip, body: { token } }).expect(410);
    });

    it('Cenário: Entrar pelo botão de acesso (RN01)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const { code, token } = await latestLoginEmail({ to: email });

      await verify({ ip, body: { token } }).expect(200);

      // E o código do mesmo e-mail deixa de funcionar.
      const response = await verify({ ip, body: { email, code } }).expect(410);
      expect(response.body.error).toBe('CHALLENGE_EXPIRED');
    });

    it('Cenário: Código vencido não entra (RN02)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const { code } = await latestLoginEmail({ to: email });
      await prisma.loginChallenge.updateMany({
        where: { email },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const response = await verify({ ip, body: { email, code } }).expect(410);

      expect(response.body.error).toBe('CHALLENGE_EXPIRED');
    });

    it('Cenário: O pedido de código não revela quem tem conta (RN03)', async () => {
      const ip = uniqueIp();
      const existing = newEmail();
      await prisma.user.create({ data: { email: existing } });
      const unknown = newEmail();

      const forExisting = await requestCode({ email: existing, ip }).expect(202);
      const forUnknown = await requestCode({ email: unknown, ip }).expect(202);

      expect(Object.keys(forExisting.body)).toEqual(Object.keys(forUnknown.body));
      expect(forUnknown.body.email).toBe(unknown);
      expect(await inbox({ to: existing })).toHaveLength(1);
      expect(await inbox({ to: unknown })).toHaveLength(1);
    });

    it('Cenário: Pedido repetido antes de 60 segundos (RN04)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);

      const response = await requestCode({ email, ip }).expect(429);

      expect(response.body).toMatchObject({
        error: 'TOO_SOON',
        resendAvailableAt: expect.any(String),
      });
    });

    it('Caso de borda: duas abas pedindo código ao mesmo tempo, só um pedido passa (RN04)', async () => {
      const ip = uniqueIp();
      const email = newEmail();

      const statuses = (
        await Promise.all([requestCode({ email, ip }), requestCode({ email, ip })])
      ).map((response) => response.status);

      expect(statuses.sort()).toEqual([202, 429]);
      expect(await prisma.loginChallenge.count({ where: { email } })).toBe(1);
    });

    it('Cenário: Pedido novo invalida o anterior (RN04)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const first = await latestLoginEmail({ to: email });
      await ageLatestRequest({ email, seconds: 61 });
      await requestCode({ email, ip }).expect(202);

      await verify({ ip, body: { token: first.token } }).expect(410);
    });

    it('Cenário: Cinco erros geram um código novo (RN05)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const { code } = await latestLoginEmail({ to: email });
      const wrong = code === '000000' ? '111111' : '000000';
      await ageLatestRequest({ email, seconds: 61 });

      for (let attemptsLeft = 4; attemptsLeft >= 1; attemptsLeft--) {
        const response = await verify({ ip, body: { email, code: wrong } }).expect(401);
        expect(response.body).toMatchObject({ error: 'INVALID_CODE', attemptsLeft });
      }
      const locked = await verify({ ip, body: { email, code: wrong } }).expect(410);

      expect(locked.body).toMatchObject({ error: 'CHALLENGE_LOCKED', newCodeSent: true });
      expect(await inbox({ to: email })).toHaveLength(2);
      const fresh = await latestLoginEmail({ to: email });
      await verify({ ip: uniqueIp(), body: { email, code: fresh.code } }).expect(200);
    });
  });

  describe('Funcionalidade: Primeiro acesso', () => {
    it('Cenário: E-mail sem conta vindo do link de indicação (RN06) cria a conta e registra conta_criada', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip, origin: 'referral', originRef: 'juliana-prado' }).expect(202);
      const { code } = await latestLoginEmail({ to: email });
      const startedAt = new Date();

      const response = await verify({ ip, body: { email, code } }).expect(200);

      expect(response.body).toMatchObject({ user: { email, isNew: true }, next: 'couple_signup' });
      const events = await backoffice.productEvent.findMany({
        where: { name: 'conta_criada', occurredAt: { gte: startedAt } },
      });
      expect(events.map((event) => event.props)).toContainEqual({
        origem: 'referral',
        metodo: 'email',
      });
      const [ipLog] = await backoffice.accessIpLog.findMany({
        where: { actorUserId: response.body.user.id },
      });
      expect(ipLog).toMatchObject({ action: 'login', ip });
    });

    it('Cenário: E-mail sem conta vindo de um convite de acesso (RN06) volta ao convite', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip, origin: 'invite', originRef: 'token-do-convite' }).expect(202);
      const { code } = await latestLoginEmail({ to: email });

      const response = await verify({ ip, body: { email, code } }).expect(200);

      expect(response.body).toMatchObject({ next: 'invite', inviteToken: 'token-do-convite' });
    });

    it('Cenário: Pela tela Entrar, sem origem, vale a Seleção de perfil (RN06)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await requestCode({ email, ip }).expect(202);
      const { code } = await latestLoginEmail({ to: email });

      const response = await verify({ ip, body: { email, code } }).expect(200);

      expect(response.body.next).toBe('choose_profile');
    });
  });

  describe('Funcionalidade: Sessão', () => {
    it('Cenário: Usuário bloqueado não entra (RN11)', async () => {
      const ip = uniqueIp();
      const email = newEmail();
      await prisma.user.create({ data: { email, status: 'blocked' } });
      await requestCode({ email, ip }).expect(202);
      const { code } = await latestLoginEmail({ to: email });

      const response = await verify({ ip, body: { email, code } }).expect(403);

      expect(response.body.error).toBe('USER_BLOCKED');
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('validação', () => {
    it.each([
      ['e-mail e token juntos', { email: 'a@kore.local', code: '123456', token: 'x'.repeat(43) }],
      ['só o e-mail', { email: 'a@kore.local' }],
      ['código com letras', { email: 'a@kore.local', code: '12ab56' }],
    ])('dado %s, quando confirma, então responde 400', async (_, body) => {
      await verify({ ip: uniqueIp(), body }).expect(400);
    });

    it('dado um e-mail mal formado, quando pede o código, então responde 400', async () => {
      await requestCode({ email: 'nao-e-email', ip: uniqueIp() }).expect(400);
    });
  });
});
