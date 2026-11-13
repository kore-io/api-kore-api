import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { publishByPayment } from '../support/payments';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrer } from '../support/referrers';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

/**
 * A central do tipo `billing` (Publicar e pagar RN13; Central RN06 e RN07;
 * decisão 236), com o pagamento confirmado pela rota dev.
 */
describe('Central: Cobrança (Publicar e pagar RN13; decisão 236; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  /** Ana, dona, publica no cartão; Juliana, cerimonialista colaboradora. */
  async function published() {
    const ana = await signedInUser({ app });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: new Date(`${eventDate}T00:00:00Z`) },
    });
    const { paymentId } = await publishByPayment({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate,
    });
    return { ana, julianaCookie, weddingId, paymentId };
  }

  it('RN13 - o pagamento confirmado aparece na central da dona, com o detalhe, e conta no sino', async () => {
    const { ana, weddingId, paymentId } = await published();
    const { body } = await http()
      .get('/v1/me/notifications')
      .set('Cookie', ana.cookie)
      .query({ weddingId })
      .expect(200);
    const billing = (body.items as { type: string }[]).filter((item) => item.type === 'billing');
    expect(billing).toEqual([
      expect.objectContaining({
        type: 'billing',
        weddingId,
        partnerNames: ['Ana', 'Marcos'],
        readAt: null,
        payload: [
          expect.objectContaining({
            kind: 'payment_confirmed',
            paymentId,
            endDate,
            method: 'card',
            installments: 2,
            cardLast4: '4242',
          }),
        ],
      }),
    ]);
    const count = await http()
      .get('/v1/me/notifications/unread-count')
      .set('Cookie', ana.cookie)
      .query({ weddingId })
      .expect(200);
    expect(count.body.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it('RN13 - o filtro "Cobrança" traz só o billing; "Respostas", nada dele', async () => {
    const { ana, weddingId } = await published();
    const only = await http()
      .get('/v1/me/notifications')
      .set('Cookie', ana.cookie)
      .query({ weddingId, type: 'billing' })
      .expect(200);
    expect(only.body.items).toHaveLength(1);
    const rsvp = await http()
      .get('/v1/me/notifications')
      .set('Cookie', ana.cookie)
      .query({ weddingId, type: 'rsvp' })
      .expect(200);
    expect(rsvp.body.items).toEqual([]);
  });

  it('RN13 (G6) - a colaboradora não vê o billing; e a central dela não aceita o filtro', async () => {
    const { julianaCookie, weddingId } = await published();
    const { body } = await http()
      .get('/v1/me/notifications')
      .set('Cookie', julianaCookie)
      .query({ weddingId })
      .expect(200);
    expect((body.items as { type: string }[]).some((item) => item.type === 'billing')).toBe(false);
    const planner = await http()
      .get('/v1/me/notifications')
      .set('Cookie', julianaCookie)
      .query({ scope: 'planner', type: 'billing' })
      .expect(400);
    expect(planner.body.errors).toEqual([expect.objectContaining({ path: 'type' })]);
  });

  it('decisão 236 - a linha "Cobrança e pagamentos": e-mail fixo em "Sempre", sem seletor; push desligado por padrão', async () => {
    const { ana, weddingId } = await published();
    const { body } = await http()
      .get('/v1/me/notification-preferences')
      .set('Cookie', ana.cookie)
      .query({ weddingId })
      .expect(200);
    expect(body.items).toEqual([
      { type: 'rsvp', inApp: true, email: 'daily', push: false, emailEditable: true },
      { type: 'billing', inApp: true, email: 'always', push: false, emailEditable: false },
    ]);

    const refused = await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({ weddingId, type: 'billing', email: 'off' })
      .expect(400);
    expect(refused.body.errors).toEqual([expect.objectContaining({ path: 'type' })]);
    // A de respostas continua editável.
    const saved = await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({ weddingId, type: 'rsvp', email: 'off' })
      .expect(200);
    expect(saved.body).toMatchObject({ type: 'rsvp', email: 'off', emailEditable: true });
  });

  it('Publicar e pagar RN13 (G6) - a colaboradora não recebe a linha "Cobrança e pagamentos", e o push do aparelho dela não grava a cobrança', async () => {
    const { ana, julianaCookie, weddingId } = await published();
    const prefs = await http()
      .get('/v1/me/notification-preferences')
      .set('Cookie', julianaCookie)
      .query({ weddingId })
      .expect(200);
    expect((prefs.body.items as { type: string }[]).map((item) => item.type)).toEqual(['rsvp']);

    const subscribe = (cookie: string) =>
      http()
        .post('/v1/me/push-subscriptions')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .set('User-Agent', 'Kore e2e')
        .send({
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`,
          keys: { p256dh: 'BPk', auth: 'aut' },
        });
    const juliana = await db.membership.findFirstOrThrow({
      where: { weddingId, role: 'collaborator' },
    });
    expect((await subscribe(julianaCookie)).status).toBeLessThan(300);
    expect((await subscribe(ana.cookie)).status).toBeLessThan(300);
    expect(
      await db.notificationPreference.count({
        where: { weddingId, userId: juliana.userId, type: 'billing' },
      }),
    ).toBe(0);
    expect(
      await db.notificationPreference.findFirstOrThrow({
        where: { weddingId, userId: ana.userId, type: 'billing' },
      }),
    ).toMatchObject({ push: true });
  });
});
