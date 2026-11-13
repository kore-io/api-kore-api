import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Central de notificações e preferências (Central RN04 a RN09; banco real). */
describe('Central de notificações (banco real)', () => {
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

  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    const notify = (
      userId: string,
      { minutes, readAt = null }: { minutes: number; readAt?: Date | null },
    ) =>
      db.notification.create({
        data: {
          userId,
          weddingId,
          type: 'rsvp',
          groupKey: `rsvp:${weddingId}:${minutes}`,
          payload: [
            {
              partyId: party.id,
              name: 'Família Moreira',
              confirmed: 2,
              declined: 1,
              at: new Date(Date.UTC(2026, 8, 12, 20, minutes)).toISOString(),
            },
          ],
          updatedAt: new Date(Date.UTC(2026, 8, 12, 20, minutes)),
          readAt,
        },
      });
    return { ana, juliana, weddingId, notify };
  }

  const get = (cookie: string, path: string, query: Record<string, string>) =>
    http().get(`/v1/me/${path}`).query(query).set('Cookie', cookie);
  const post = (cookie: string, path: string, query: Record<string, string> = {}) =>
    http().post(`/v1/me/${path}`).query(query).set('Cookie', cookie).set('Origin', APP_ORIGIN);

  it('RN04 e RN06 - a página: mais novas primeiro, 20 por vez, com o filtro por tipo; o contador das não lidas', async () => {
    const { ana, weddingId, notify } = await scenario();
    for (let minute = 0; minute < 22; minute++)
      await notify(ana.userId, { minutes: minute, readAt: minute < 2 ? new Date() : null });

    const first = await get(ana.cookie, 'notifications', { weddingId }).expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items[0]).toMatchObject({
      type: 'rsvp',
      count: 1,
      readAt: null,
      updatedAt: '2026-09-12T20:21:00.000Z',
      payload: [{ name: 'Família Moreira', confirmed: 2, declined: 1 }],
    });
    const second = await get(ana.cookie, 'notifications', {
      weddingId,
      cursor: first.body.nextCursor as string,
    }).expect(200);
    expect((second.body.items as { updatedAt: string }[]).map((item) => item.updatedAt)).toEqual([
      '2026-09-12T20:01:00.000Z',
      '2026-09-12T20:00:00.000Z',
    ]);
    expect(second.body.nextCursor).toBeNull();
    expect(
      (await get(ana.cookie, 'notifications', { weddingId, type: 'rsvp' }).expect(200)).body.items,
    ).toHaveLength(20);
    await get(ana.cookie, 'notifications', { weddingId, type: 'gift' }).expect(400);

    const unread = await get(ana.cookie, 'notifications/unread-count', { weddingId }).expect(200);
    expect(unread.body).toEqual({ unreadCount: 20 });
  });

  it('RN05 e RN06 - abrir marca como lida; marcar todas; a de outra pessoa é 404', async () => {
    const { ana, juliana, weddingId, notify } = await scenario();
    const mine = await notify(ana.userId, { minutes: 1 });
    await notify(ana.userId, { minutes: 2 });
    const other = await notify(juliana.userId, { minutes: 3 });

    await post(ana.cookie, `notifications/${mine.id}/read`).expect(204);
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: mine.id } })).readAt,
    ).not.toBeNull();
    // Abrir de novo não muda nada.
    await post(ana.cookie, `notifications/${mine.id}/read`).expect(204);
    await post(ana.cookie, `notifications/${other.id}/read`).expect(404);
    expect(
      (await db.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt,
    ).toBeNull();

    await post(ana.cookie, 'notifications/read-all', { weddingId }).expect(204);
    expect(await db.notification.count({ where: { userId: ana.userId, readAt: null } })).toBe(0);
    expect(await db.notification.count({ where: { userId: juliana.userId, readAt: null } })).toBe(
      1,
    );
  });

  it('RN09 - perder o vínculo esconde as notificações daquele casamento', async () => {
    const { ana, weddingId, notify } = await scenario();
    const notification = await notify(ana.userId, { minutes: 1 });
    await db.membership.updateMany({
      where: { weddingId, userId: ana.userId },
      data: { removedAt: new Date() },
    });

    await get(ana.cookie, 'notifications', { weddingId }).expect(404);
    await get(ana.cookie, 'notifications/unread-count', { weddingId }).expect(404);
    await post(ana.cookie, `notifications/${notification.id}/read`).expect(404);
  });

  it('RN06 - a colaboradora (até a F6) não tem notificações: o contador é 0', async () => {
    const { juliana, weddingId } = await scenario();

    const unread = await get(juliana.cookie, 'notifications/unread-count', { weddingId }).expect(
      200,
    );
    expect(unread.body.unreadCount).toBe(0);
  });

  it('RN07 - as preferências: o padrão sem linha, o e-mail gravado na hora, o push deste aparelho', async () => {
    const { ana, juliana, weddingId } = await scenario();

    const defaults = await get(ana.cookie, 'notification-preferences', { weddingId }).expect(200);
    expect(defaults.body).toEqual({
      items: [
        { type: 'rsvp', inApp: true, email: 'daily', push: false, emailEditable: true },
        // Cobrança e pagamentos (F3): o e-mail sempre sai, sem seletor (decisão 236).
        { type: 'billing', inApp: true, email: 'always', push: false, emailEditable: false },
      ],
      push: { subscribed: false, vapidPublicKey: process.env.VAPID_PUBLIC_KEY },
    });

    const saved = await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ weddingId, type: 'rsvp', email: 'immediate' })
      .expect(200);
    expect(saved.body).toEqual({
      type: 'rsvp',
      inApp: true,
      email: 'immediate',
      push: false,
      emailEditable: true,
    });
    // Cada pessoa tem as suas.
    expect(
      (await get(juliana.cookie, 'notification-preferences', { weddingId }).expect(200)).body
        .items[0].email,
    ).toBe('daily');

    const session = await db.session.findFirstOrThrow({
      where: { userId: ana.userId },
      orderBy: { createdAt: 'desc' },
    });
    await db.pushSubscription.create({
      data: {
        userId: ana.userId,
        sessionId: session.id,
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString('hex')}`,
        p256dh: 'p',
        auth: 'a',
      },
    });
    const withPush = await get(ana.cookie, 'notification-preferences', { weddingId }).expect(200);
    expect(withPush.body.push.subscribed).toBe(true);
    expect(withPush.body.items[0].email).toBe('immediate');
  });

  it('RN07 e RN09 - tipo que não existe na fase é 400; casamento sem vínculo é 404', async () => {
    const { ana, weddingId } = await scenario();
    const other = await scenario();

    const put = (body: object) =>
      http()
        .put('/v1/me/notification-preferences')
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send(body);
    await put({ weddingId, type: 'gift', email: 'off' }).expect(400);
    await put({ weddingId: other.weddingId, type: 'rsvp', email: 'off' }).expect(404);
    await get(ana.cookie, 'notification-preferences', { weddingId: other.weddingId }).expect(404);
  });
});
