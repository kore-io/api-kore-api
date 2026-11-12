import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** A assinatura de push do aparelho (E-mail e push RN07 e RN08; banco real). */
describe('Assinaturas de push (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`;
  const subscribe = (cookie: string, url: string) =>
    http()
      .post('/v1/me/push-subscriptions')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .set('User-Agent', 'Kore e2e')
      .send({ endpoint: url, keys: { p256dh: 'BPk', auth: 'aut' } });
  const unsubscribe = (cookie: string, url: string) =>
    http()
      .delete('/v1/me/push-subscriptions')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ endpoint: url });
  const preferences = async (cookie: string, weddingId: string) =>
    (
      await http()
        .get('/v1/me/notification-preferences')
        .query({ weddingId })
        .set('Cookie', cookie)
        .expect(200)
    ).body as { items: { push: boolean }[]; push: { subscribed: boolean; vapidPublicKey: string } };
  const sessionOf = async (userId: string) =>
    (await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: 'desc' } })).id;

  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    return { ana, weddingId };
  }

  it('RN07 - ligar neste aparelho grava a assinatura presa à sessão, liga a preferência e devolve a chave pública', async () => {
    const { ana, weddingId } = await scenario();
    const url = endpoint();

    await subscribe(ana.cookie, url).expect(201);

    expect(await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: url } })).toMatchObject(
      {
        userId: ana.userId,
        sessionId: await sessionOf(ana.userId),
        userAgent: 'Kore e2e',
      },
    );
    const view = await preferences(ana.cookie, weddingId);
    expect(view.push).toEqual({ subscribed: true, vapidPublicKey: process.env.VAPID_PUBLIC_KEY });
    expect(view.items[0].push).toBe(true);
  });

  it('RN07 (217(c)) - o endpoint fora da lista fechada é recusado e nada é gravado', async () => {
    const { ana } = await scenario();

    for (const url of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://evil.example.com/push',
    ]) {
      const response = await subscribe(ana.cookie, url).expect(400);
      expect(response.body.error).toBe('PUSH_ENDPOINT_NOT_ALLOWED');
    }
    expect(await db.pushSubscription.count({ where: { userId: ana.userId } })).toBe(0);
  });

  it('RN07 (R8-7) - o mesmo endpoint de outra pessoa passa para a sessão atual', async () => {
    const { ana } = await scenario();
    const marcos = await signedInUser({ app, name: 'Marcos' });
    const url = endpoint();
    await subscribe(ana.cookie, url).expect(201);

    await subscribe(marcos.cookie, url).expect(201);

    expect(await db.pushSubscription.findMany({ where: { endpoint: url } })).toEqual([
      expect.objectContaining({ userId: marcos.userId, sessionId: await sessionOf(marcos.userId) }),
    ]);
  });

  it('RN07 e 217(8) - desligar apaga a deste aparelho; a preferência só desliga quando sai a última', async () => {
    const { ana, weddingId } = await scenario();
    const phone = endpoint();
    const laptop = endpoint();
    const otherCookie = await openSession({ app, userId: ana.userId });
    await subscribe(ana.cookie, phone).expect(201);
    await subscribe(otherCookie, laptop).expect(201);

    await unsubscribe(ana.cookie, phone).expect(204);
    expect((await preferences(otherCookie, weddingId)).items[0].push).toBe(true);

    await unsubscribe(otherCookie, laptop).expect(204);
    expect((await preferences(otherCookie, weddingId)).items[0].push).toBe(false);
    expect(await db.pushSubscription.count({ where: { userId: ana.userId } })).toBe(0);
  });

  it('RN08 - Sair apaga o push deste aparelho; Sair de todos apaga todos', async () => {
    const { ana } = await scenario();
    const phone = endpoint();
    const laptop = endpoint();
    const tablet = endpoint();
    const laptopCookie = await openSession({ app, userId: ana.userId });
    const tabletCookie = await openSession({ app, userId: ana.userId });
    await subscribe(ana.cookie, phone).expect(201);
    await subscribe(laptopCookie, laptop).expect(201);
    await subscribe(tabletCookie, tablet).expect(201);

    await http()
      .post('/v1/auth/logout')
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .expect((response) => expect(response.status).toBeLessThan(300));
    expect(
      (await db.pushSubscription.findMany({ where: { userId: ana.userId } }))
        .map((row) => row.endpoint)
        .sort(),
    ).toEqual([laptop, tablet].sort());

    await http()
      .post('/v1/auth/logout-all')
      .set('Cookie', laptopCookie)
      .set('Origin', APP_ORIGIN)
      .expect((response) => expect(response.status).toBeLessThan(300));
    expect(await db.pushSubscription.count({ where: { userId: ana.userId } })).toBe(0);
  });
});
