import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import type {
  PushResult,
  PushTarget,
} from '@/modules/notifications/application/ports/push-sender.port';
import { PUSH_STORE } from '@/modules/notifications/application/ports/push-store.port';
import { RsvpPush } from '@/modules/notifications/application/rsvp-push.use-case';
import { AppConfigService } from '@/shared/config/app-config.service';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { seedInvitation } from '../support/factories/invitations';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

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
  it('Notificações da cerimonialista RN06 e RN07 - o switch deste aparelho liga o push de Novas respostas dela pela preferência geral', async () => {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId: juliana.userId });
    const { id: anaId } = await db.user.create({
      data: { email: `ana.${randomUUID()}@kore.local`, name: 'Ana Beatriz' },
    });
    const { weddingId } = await seedWedding({
      db,
      ownerId: anaId,
      collaboratorIds: [juliana.userId],
    });
    const at = new Date(Date.now() - 60_000);
    await db.notification.create({
      data: {
        userId: juliana.userId,
        weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${weddingId}`,
        payload: [
          {
            partyId: randomUUID(),
            name: 'Família Moreira',
            confirmed: 2,
            declined: 0,
            at: at.toISOString(),
          },
        ],
        updatedAt: at,
      },
    });
    const general = async () =>
      (
        (await http().get('/v1/me/notification-preferences').set('Cookie', cookie).expect(200))
          .body as { items: { type: string; push: boolean }[] }
      ).items.find((item) => item.type === 'rsvp')?.push;
    const worker = await createTestWorker();
    const sent: PushTarget[] = [];
    const push = new RsvpPush(
      worker.get(PUSH_STORE),
      {
        enabled: () => true,
        send: ({ target }: { target: PushTarget }) => {
          sent.push(target);
          return Promise.resolve('sent' as PushResult);
        },
      },
      worker.get(AppConfigService),
    );
    try {
      const url = endpoint();
      await subscribe(cookie, url).expect(201);
      expect(await general()).toBe(true);
      // Só Novas respostas tem push (RN06): as outras linhas gerais não nascem.
      expect(
        await db.notificationPreference.findMany({
          where: { userId: juliana.userId, weddingId: null },
          select: { type: true, push: true },
        }),
      ).toEqual([{ type: 'rsvp', push: true }]);
      expect(await push.send({ userId: juliana.userId, weddingId, now: new Date() })).toEqual({
        sent: 1,
      });

      // Sem a última assinatura, a geral volta a false e o push não sai.
      await unsubscribe(cookie, url).expect(204);
      expect(await general()).toBe(false);
      expect(await push.send({ userId: juliana.userId, weddingId, now: new Date() })).toEqual({
        sent: 0,
      });
      expect(sent).toHaveLength(1);
    } finally {
      await worker.close();
    }
  });

  it('RN07 - quem não tem o perfil de cerimonialista não ganha a preferência geral', async () => {
    const { ana } = await scenario();

    await subscribe(ana.cookie, endpoint()).expect(201);

    expect(
      await db.notificationPreference.count({ where: { userId: ana.userId, weddingId: null } }),
    ).toBe(0);
  });

  describe('decisão 310(2) - a preferência geral de Novas respostas da cerimonialista', () => {
    const general = (userId: string) =>
      db.notificationPreference.findMany({
        where: { userId, weddingId: null },
        select: { type: true, push: true },
      });

    it('Notificações da cerimonialista RN06 - dois aparelhos ligando ao mesmo tempo (duas conexões): 201 e uma linha geral, sem 500', async () => {
      const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
      const cookie = await openSession({ app, userId: juliana.userId });
      // A outra conexão é o outro aparelho: grava a geral e segura a transação;
      // este pedido não a vê e esbarra no único até ela terminar.
      const other = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
      await other.connect();
      try {
        await other.query('BEGIN');
        await other.query(
          `INSERT INTO notification_preferences (id, user_id, wedding_id, type, push, updated_at)
           VALUES ($1, $2, NULL, 'rsvp', true, now())`,
          [uuidV7(), juliana.userId],
        );
        const pending = subscribe(cookie, endpoint()).then((response) => response);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await other.query('COMMIT');

        expect((await pending).status).toBe(201);
      } finally {
        await other.end();
      }
      expect(await general(juliana.userId)).toEqual([{ type: 'rsvp', push: true }]);
    });

    it('Notificações da cerimonialista RN06 - quem já tem aparelho inscrito e cria o perfil de cerimonialista: a geral nasce com o push ligado', async () => {
      const ana = await signedInUser({ app, name: `Ana ${randomUUID().slice(0, 8)}` });
      await subscribe(ana.cookie, endpoint()).expect(201);
      const bia = await signedInUser({ app, name: `Bia ${randomUUID().slice(0, 8)}` });
      const signup = (cookie: string) =>
        http()
          .post('/v1/me/planner')
          .set('Cookie', cookie)
          .set('Origin', APP_ORIGIN)
          .send({
            creditName: 'Prado Assessoria',
            phone: '(19) 3333-4444',
            whatsapp: '(19) 99999-8888',
            cities: ['Campinas (SP)'],
            termsVersion: process.env.TERMS_VERSION,
          })
          .expect(201);

      await signup(ana.cookie);
      await signup(bia.cookie);

      expect(await general(ana.userId)).toEqual([{ type: 'rsvp', push: true }]);
      // Sem aparelho inscrito, nada nasce (vale o padrão, push desligado).
      expect(await general(bia.userId)).toEqual([]);
    });

    it('Notificações da cerimonialista RN06 - o perfil mínimo do aceite do convite também: a geral nasce com o push ligado', async () => {
      const owner = await signedInUser({ app, name: 'Ana Beatriz' });
      const { weddingId } = await seedWedding({ db, ownerId: owner.userId });
      const clara = await signedInUser({ app, name: `Clara ${randomUUID().slice(0, 8)}` });
      await subscribe(clara.cookie, endpoint()).expect(201);
      const { email } = await db.user.findUniqueOrThrow({ where: { id: clara.userId } });
      const { token } = await seedInvitation({
        db,
        weddingId,
        kind: 'planner',
        email,
        invitedByUserId: owner.userId,
      });

      await http()
        .post(`/v1/access-invitations/${token}/accept`)
        .set('Cookie', clara.cookie)
        .set('Origin', APP_ORIGIN)
        .send({})
        .expect(200);

      expect(await general(clara.userId)).toEqual([{ type: 'rsvp', push: true }]);
    });

    it('a geral que já existe não muda quando o perfil nasce', async () => {
      const ana = await signedInUser({ app, name: `Ana ${randomUUID().slice(0, 8)}` });
      await subscribe(ana.cookie, endpoint()).expect(201);
      await db.notificationPreference.create({
        data: { userId: ana.userId, weddingId: null, type: 'rsvp', push: false },
      });

      await http()
        .post('/v1/me/planner')
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send({
          creditName: 'Prado Assessoria',
          cities: ['Campinas (SP)'],
          termsVersion: process.env.TERMS_VERSION,
        })
        .expect(201);

      expect(await general(ana.userId)).toEqual([{ type: 'rsvp', push: false }]);
    });
  });
});
