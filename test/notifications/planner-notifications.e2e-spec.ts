import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

/**
 * Notificações da cerimonialista (F6, C8), com o banco real: o rsvp para a
 * colaboradora, o wedding_published na primeira publicação, o
 * membership_removed, a central com scope=planner, a preferência geral e as
 * policies por tipo (D18: quem saiu não vê mais as respostas antigas).
 */
describe('Notificações da cerimonialista (banco real; decisões 223 e 224)', () => {
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
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
  const central = (cookie: string, query: Record<string, string> = { scope: 'planner' }) =>
    http().get('/v1/me/notifications').query(query).set('Cookie', cookie);

  /** Ana e Marcos, com Juliana (cerimonialista) colaboradora e indicadora. */
  async function scenario({ publish = true }: { publish?: boolean } = {}) {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        ...(publish
          ? {
              status: 'published',
              publishedAt: new Date(),
              endDate: new Date(`${day(90)}T00:00:00Z`),
              publicationSource: 'courtesy',
            }
          : {}),
      },
    });
    return { ana, juliana, julianaCookie, weddingId, slug };
  }

  /** A Família Moreira responde pelo link (RSVP RN04): uma gravação do grupo. */
  async function respond({
    ana,
    weddingId,
    slug,
  }: {
    ana: { cookie: string };
    weddingId: string;
    slug: string;
  }) {
    const created = await http()
      .post(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ name: 'Família Moreira', guests: [{ name: 'Célia Moreira', ageGroup: 'adult' }] })
      .expect(201);
    const party = await db.party.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const from = ip();
    const session = await http()
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send({ token: party.linkToken })
      .expect(200);
    const cookie = ([] as string[]).concat(session.headers['set-cookie'])[0].split(';')[0];
    const form = await http()
      .get(`/v1/sites/${slug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .expect(200);
    const celia = (form.body.guests as { id: string }[])[0];
    await http()
      .put(`/v1/sites/${slug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', from)
      .send({
        version: form.body.party.version as number,
        signedByGuestId: celia.id,
        guests: [{ id: celia.id, status: 'confirmed' }],
      })
      .expect(200);
  }

  it('RN02 e RN05 - a resposta vai também à colaboradora, e a central dela traz o casamento e os nomes', async () => {
    const { ana, juliana, julianaCookie, weddingId, slug } = await scenario();

    await respond({ ana, weddingId, slug });

    const rows = await db.notification.findMany({ where: { weddingId, type: 'rsvp' } });
    expect(rows.map((row) => row.userId).sort()).toEqual([ana.userId, juliana.userId].sort());
    const { body } = await central(julianaCookie).expect(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        type: 'rsvp',
        weddingId,
        partnerNames: ['Ana', 'Marcos'],
        count: 1,
        readAt: null,
      }),
    ]);
    expect(
      (
        await http()
          .get('/v1/me/notifications/unread-count')
          .query({ scope: 'planner' })
          .set('Cookie', julianaCookie)
          .expect(200)
      ).body,
    ).toEqual({ unreadCount: 1 });
  });

  it('RN02 - o vendedor colaborador não recebe a resposta', async () => {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const lucas = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [lucas.userId],
    });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status: 'published',
        publishedAt: new Date(),
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        endDate: new Date(`${day(90)}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });

    await respond({ ana, weddingId, slug });

    expect(await db.notification.count({ where: { weddingId, userId: lucas.userId } })).toBe(0);
  });

  it('RN03 - a primeira publicação avisa a colaboradora e a indicadora; a mesma pessoa, uma linha só', async () => {
    const { ana, juliana, julianaCookie, weddingId } = await scenario({ publish: false });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    await db.wedding.update({
      where: { id: weddingId },
      data: { referrerId: referrer.id, referralSource: 'referral_link' },
    });

    // A primeira publicação, pelo pagamento confirmado (Publicar e pagar RN05 e RN17).
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate: day(90) });

    const rows = await db.notification.findMany({
      where: { weddingId, type: 'wedding_published' },
    });
    expect(rows).toEqual([
      expect.objectContaining({
        userId: juliana.userId,
        groupKey: `wedding_published:${weddingId}`,
        payload: [{ partnerNames: ['Ana', 'Marcos'] }],
      }),
    ]);
    const { body } = await central(julianaCookie, {
      scope: 'planner',
      type: 'wedding_published',
    }).expect(200);
    expect(body.items).toEqual([
      expect.objectContaining({ type: 'wedding_published', partnerNames: ['Ana', 'Marcos'] }),
    ]);
  });

  it('RN03 e RN10 - a indicadora sem vínculo também é avisada e vê o aviso pela policy do tipo', async () => {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug: `ana-e-marcos-${randomUUID().slice(0, 8)}`,
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });

    // A primeira publicação, pelo pagamento confirmado (Publicar e pagar RN05 e RN17).
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate: day(90) });

    const { body } = await central(julianaCookie).expect(200);
    expect(body.items).toEqual([expect.objectContaining({ type: 'wedding_published', weddingId })]);
  });

  it('RN04, RN05 e D18 - o dono remove: ela recebe "Colaboração encerrada" e deixa de ver as respostas antigas', async () => {
    const { ana, juliana, julianaCookie, weddingId, slug } = await scenario();
    await respond({ ana, weddingId, slug });
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: juliana.userId },
    });

    await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    const { body } = await central(julianaCookie).expect(200);
    expect(body.items).toEqual([
      expect.objectContaining({
        type: 'membership_removed',
        weddingId,
        partnerNames: ['Ana', 'Marcos'],
      }),
    ]);
    const removed = await db.notification.findFirstOrThrow({
      where: { userId: juliana.userId, type: 'membership_removed' },
    });
    expect(removed.groupKey).toBe(`membership_removed:${membership.id}`);
  });

  it('RN04 - quando ela sai por conta própria, nada', async () => {
    const { juliana, julianaCookie, weddingId } = await scenario();
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: juliana.userId },
    });

    await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', julianaCookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    expect(
      await db.notification.count({
        where: { userId: juliana.userId, type: 'membership_removed' },
      }),
    ).toBe(0);
  });

  it('RN05 - o escopo: sem o casamento de que ela é dona; ler todas não marca as do casal; sem perfil, 403', async () => {
    const { ana, juliana, julianaCookie, weddingId, slug } = await scenario();
    await respond({ ana, weddingId, slug });
    // Juliana também é dona de Juliana e Pedro, com uma resposta lá.
    const own = await seedWedding({ db, ownerId: juliana.userId });
    await db.notification.create({
      data: {
        userId: juliana.userId,
        weddingId: own.weddingId,
        type: 'rsvp',
        groupKey: `rsvp:${own.weddingId}`,
        payload: [],
      },
    });

    expect(
      ((await central(julianaCookie).expect(200)).body.items as { weddingId: string }[]).map(
        (item) => item.weddingId,
      ),
    ).toEqual([weddingId]);
    await http()
      .post('/v1/me/notifications/read-all')
      .query({ scope: 'planner' })
      .set('Cookie', julianaCookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);
    expect(
      await db.notification.count({
        where: { userId: juliana.userId, weddingId: own.weddingId, readAt: null },
      }),
    ).toBe(1);

    expect((await central(ana.cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    await central(julianaCookie, { scope: 'planner', weddingId }).expect(400);
    // A central do casal segue só com os tipos dela.
    await central(ana.cookie, { weddingId, type: 'wedding_published' }).expect(400);
  });

  it('RN06 - a preferência geral: os 4 tipos (com a Comissão da F3) com o padrão, gravada sem casamento; a do casal não muda', async () => {
    const { ana, juliana, julianaCookie, weddingId } = await scenario();

    const before = await http()
      .get('/v1/me/notification-preferences')
      .set('Cookie', julianaCookie)
      .expect(200);
    expect(before.body.items).toEqual([
      { type: 'rsvp', inApp: true, email: 'daily', push: false, emailEditable: true },
      { type: 'wedding_published', inApp: true, email: 'daily', push: false, emailEditable: true },
      { type: 'membership_removed', inApp: true, email: 'daily', push: false, emailEditable: true },
      // Comissões do indicador RN09 (decisão 242): a linha Comissão, com o mesmo padrão.
      { type: 'commission', inApp: true, email: 'daily', push: false, emailEditable: true },
    ]);

    const saved = await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', julianaCookie)
      .set('Origin', APP_ORIGIN)
      .send({ type: 'wedding_published', email: 'immediate' })
      .expect(200);
    expect(saved.body).toEqual({
      type: 'wedding_published',
      inApp: true,
      email: 'immediate',
      push: false,
      emailEditable: true,
    });
    await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', julianaCookie)
      .set('Origin', APP_ORIGIN)
      .send({ type: 'wedding_published', email: 'off' })
      .expect(200);
    expect(
      await db.notificationPreference.findMany({
        where: { userId: juliana.userId, weddingId: null },
        select: { type: true, email: true },
      }),
    ).toEqual([{ type: 'wedding_published', email: 'off' }]);

    // A do casal (por casamento) não muda, e o casal não tem a geral.
    const couple = await http()
      .get('/v1/me/notification-preferences')
      .query({ weddingId })
      .set('Cookie', ana.cookie)
      .expect(200);
    expect((couple.body.items as { type: string }[]).map((item) => item.type)).toEqual([
      'rsvp',
      'billing',
    ]);
    expect(
      (await http().get('/v1/me/notification-preferences').set('Cookie', ana.cookie).expect(403))
        .body.error,
    ).toBe('PROFILE_NOT_OWNED');
    await http()
      .put('/v1/me/notification-preferences')
      .set('Cookie', julianaCookie)
      .set('Origin', APP_ORIGIN)
      .send({ weddingId: null, type: 'rsvp', email: 'off' })
      .expect(400);
  });

  it('RN10 - as policies por tipo, no SQL com o kore_api: quem saiu não vê o rsvp, vê o membership_removed', async () => {
    const { juliana, weddingId } = await scenario();
    const base = { userId: juliana.userId, weddingId, payload: [] };
    await db.notification.createMany({
      data: [
        { ...base, type: 'rsvp', groupKey: `rsvp:${weddingId}` },
        { ...base, type: 'membership_removed', groupKey: `membership_removed:${randomUUID()}` },
      ],
    });
    await db.membership.updateMany({
      where: { weddingId, userId: juliana.userId },
      data: { removedAt: new Date() },
    });

    const api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
    try {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [juliana.userId]);
      const { rows } = await api.query<{ type: string }>(
        'SELECT type::text FROM notifications WHERE wedding_id = $1',
        [weddingId],
      );
      expect(rows.map((row) => row.type)).toEqual(['membership_removed']);
      // E a função de aviso da publicação é só do worker (G5): o app não a chama.
      await expect(
        api.query('SELECT notify_wedding_published_for($1::uuid, $2::uuid[])', [
          weddingId,
          [randomUUID()],
        ]),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await api.query('ROLLBACK');
      await api.end();
    }
  });
});
