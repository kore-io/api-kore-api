import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { IpHasher } from '@/modules/logs/infrastructure/providers/ip-hasher';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { PrismaService } from '@/shared/database/prisma.service';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { latestLoginEmail } from '../support/harness/mailpit';
import { staffUser } from '../support/harness/sessions';

const uniqueIp = () => `10.${randomInt(255)}.${randomInt(255)}.${randomInt(1, 255)}`;
const MINUTE = 60_000;

/**
 * O alerta login_abuse (Backoffice - acesso RN12; decisão 275): mais de 10
 * códigos errados em 1 h para o mesmo e-mail ou o mesmo IP. O kore_test é
 * compartilhado: cada caso usa e-mail e IP próprios.
 */
describe('Backoffice: o alerta login_abuse (Backoffice - acesso RN12; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    // O e-mail do código sai pela fila: o worker é quem envia.
    worker = await createTestWorker();
    prisma = app.get(PrismaService);
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const requestCode = ({ email, ip }: { email: string; ip: string }) =>
    http().post('/v1/auth/login-challenges').set('X-Forwarded-For', ip).send({ email });
  const verify = ({ ip, email, code }: { ip: string; email: string; code: string }) =>
    http()
      .post('/v1/auth/login-challenges/verify')
      .set('X-Forwarded-For', ip)
      .send({ email, code });
  // O pedido mais recente fica 61 s mais velho: o 5º erro pode mandar outro código (RN04).
  const ageLatest = async (email: string) => {
    const latest = await prisma.loginChallenge.findFirstOrThrow({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.loginChallenge.update({
      where: { id: latest.id },
      data: { createdAt: new Date(latest.createdAt.getTime() - 61_000) },
    });
  };
  const loginAlerts = (entityType: 'login_email' | 'login_ip') =>
    db.alert.findMany({ where: { type: 'login_abuse', entityType, status: 'open' } });
  // O kore_test é compartilhado: o alerta do caso é o da conta dele, não o de
  // outra rodada que abriu um alerta por e-mail no meio (decisão 303(3)).
  const emailAlertsOf = (userId: string) =>
    db.alert.findMany({
      where: { type: 'login_abuse', entityType: 'login_email', status: 'open', userId },
    });
  const failuresFromIp = (ipHash: string) =>
    db.applicationLog.count({ where: { action: 'login.code_failed', ipHash } });

  it('RN12 - o 11º código errado em 1 h para o mesmo e-mail abre um alerta, com a conta e o e-mail mascarado; o suporte o vê', async () => {
    const email = `abuso.${randomUUID()}@kore.local`;
    const user = await prisma.user.create({
      data: { id: randomUUID(), email, name: 'Pessoa Alvo' },
    });

    let wrongCodes = 0;
    let sent = 1;
    await requestCode({ email, ip: uniqueIp() }).expect(202);
    while (wrongCodes < 10) {
      const { code } = await latestLoginEmail({ to: email, count: sent });
      const wrong = code === '000000' ? '111111' : '000000';
      await ageLatest(email);
      for (let attempt = 1; attempt <= 5 && wrongCodes < 10; attempt++) {
        // Cada tentativa de um IP novo: o alerta é pelo e-mail.
        await verify({ ip: uniqueIp(), email, code: wrong });
        wrongCodes++;
      }
      sent++;
    }
    expect(await emailAlertsOf(user.id)).toHaveLength(0);

    const { code } = await latestLoginEmail({ to: email, count: sent - 1 });
    await verify({ ip: uniqueIp(), email, code: code === '000000' ? '111111' : '000000' });

    const opened = await emailAlertsOf(user.id);
    expect(opened).toHaveLength(1);
    const [alert] = opened;
    expect(alert).toMatchObject({
      userId: user.id,
      data: { emailMasked: `${email.slice(0, 3)}***@kore.local`, failures: 11, windowMinutes: 60 },
    });
    // O e-mail não fica em claro no log nem no alerta.
    const lines = await db.applicationLog.findMany({
      where: { action: 'login.code_failed', entityId: alert.entityId },
    });
    expect(lines).toHaveLength(11);
    expect(JSON.stringify([alert, lines])).not.toContain(email);

    const support = await staffUser({ app, role: 'support' });
    const listed = await http()
      .get('/v1/admin/alerts')
      .query({ status: 'open' })
      .set('Cookie', support.cookie)
      .expect(200);
    const all = [listed.body] as { total: number; items: { id: string }[] }[];
    for (let page = 2; all.at(-1)!.items.some(Boolean) && page <= 20; page++)
      all.push(
        (
          await http()
            .get('/v1/admin/alerts')
            .query({ status: 'open', page })
            .set('Cookie', support.cookie)
            .expect(200)
        ).body,
      );
    expect(all.flatMap((body) => body.items.map((item) => item.id))).toContain(alert.id);
  });

  it('RN12 - pelo mesmo IP: só os erros da última hora contam, e o alerta é um só enquanto aberto', async () => {
    const ip = uniqueIp();
    const ipHash = app.get(IpHasher).hash({ ip });
    const now = Date.now();
    // 10 erros anteriores deste IP, um deles fora da hora.
    await db.applicationLog.createMany({
      data: [61, ...Array.from({ length: 9 }, (_, index) => 50 - index)].map((minutes) => ({
        id: randomUUID(),
        createdAt: new Date(now - minutes * MINUTE),
        actorKind: 'system' as const,
        action: 'login.code_failed',
        entityType: 'login_email',
        entityId: randomUUID(),
        ipHash,
      })),
    });
    // Cada erro deixa a sua linha no log antes da resposta; se uma sumir (o
    // monitor engole a falha para não trocar o 401), o teste diz qual.
    const wrongFrom = async () => {
      const email = `ip.${randomUUID()}@kore.local`;
      await requestCode({ email, ip: uniqueIp() }).expect(202);
      const { code } = await latestLoginEmail({ to: email });
      const logged = await failuresFromIp(ipHash);
      await verify({ ip, email, code: code === '000000' ? '111111' : '000000' }).expect(401);
      expect({ ipFailuresLogged: await failuresFromIp(ipHash) }).toEqual({
        ipFailuresLogged: logged + 1,
      });
    };

    await wrongFrom();
    expect((await loginAlerts('login_ip')).filter((alert) => alert.entityId === ipHash)).toEqual(
      [],
    );
    await wrongFrom();
    await wrongFrom();
    const alerts = (await loginAlerts('login_ip')).filter((alert) => alert.entityId === ipHash);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      userId: null,
      data: { ipHashShort: ipHash.slice(0, 8), failures: 12, windowMinutes: 60 },
    });
  });
});
