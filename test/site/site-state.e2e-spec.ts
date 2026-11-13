import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

/**
 * A função única do "site no ar" (Data de saída do ar RN07 e RN08; revisão
 * técnica G4 e B4-4): o site, o link do grupo, o RSVP e os envios num
 * casamento em carência, expirado, com exclusão agendada e bloqueado.
 */
describe('O site no ar pela wedding_site_state (Data de saída do ar RN07 e RN08; banco real)', () => {
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
  const date = (offset: number) => new Date(`${day(offset)}T00:00:00Z`);

  /** Ana & Marcos publicado, com a Família Moreira e o cookie do grupo. */
  async function scenario() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
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
        status: 'published',
        publishedAt: new Date(Date.now() - 100 * DAY_MS),
        eventDate: date(-60),
        endDate: date(30),
        publicationSource: 'courtesy',
      },
    });
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
    return { ana, juliana, weddingId, slug, party, cookie, from };
  }

  const site = (slug: string) => http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);
  const partySession = (slug: string, token: string) =>
    http()
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', ip())
      .send({ token });
  const rsvp = (slug: string, cookie: string, from: string, body: object) =>
    http()
      .put(`/v1/sites/${slug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', from)
      .send(body);
  const answer = async (slug: string, cookie: string) => {
    const form = await http()
      .get(`/v1/sites/${slug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .expect(200);
    const guest = (form.body.guests as { id: string }[])[0];
    return {
      version: form.body.party.version as number,
      signedByGuestId: guest.id,
      guests: [{ id: guest.id, status: 'confirmed' }],
    };
  };

  it('RN08 e D21 - na carência o site e o link do grupo funcionam; o RSVP fecha como no pós-evento', async () => {
    const { slug, party, cookie, from } = await scenario();
    const body = await answer(slug, cookie);
    await db.wedding.updateMany({
      where: { slug },
      data: { status: 'grace', endDate: date(-2), graceUntil: date(5) },
    });

    await site(slug).expect(200);
    await partySession(slug, party.linkToken).expect(200);
    // O RSVP segue a regra do pós-evento (a carência vem sempre depois do
    // casamento): fechado como no pós-evento, não como site fora do ar.
    const answered = await rsvp(slug, cookie, from, body).expect(409);
    expect(answered.body.error).not.toBe('SITE_EXPIRED');
  });

  it('RN08 - expirado: 410 SITE_EXPIRED com no-store, sem dado do casal, no site e no link do grupo', async () => {
    const { weddingId, slug, party } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'expired', endDate: date(-10), graceUntil: date(-3), expiredAt: date(-2) },
    });

    const response = await site(slug).expect(410);
    expect(response.body).toEqual({
      statusCode: 410,
      error: 'SITE_EXPIRED',
      message: expect.any(String),
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const link = await partySession(slug, party.linkToken).expect(410);
    expect(link.headers['cache-control']).toBe('no-store');
  });

  it('RN08 - exclusão agendada: 410 SITE_EXPIRED, mesmo publicado', async () => {
    const { weddingId, slug } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: { deletionScheduledFor: date(7), deletionRequestedByUserId: null },
    });
    const response = await site(slug).expect(410);
    expect(response.body.error).toBe('SITE_EXPIRED');
  });

  it('RN08 - bloqueado: 423 SITE_UNAVAILABLE com no-store; o bloqueio vem antes do expirado', async () => {
    const { weddingId, slug, party } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        blockedAt: new Date(),
        status: 'expired',
        expiredAt: date(-1),
        endDate: date(-9),
        graceUntil: date(-2),
      },
    });
    const response = await site(slug).expect(423);
    expect(response.body).toEqual({
      statusCode: 423,
      error: 'SITE_UNAVAILABLE',
      message: expect.any(String),
    });
    expect(response.headers['cache-control']).toBe('no-store');
    await partySession(slug, party.linkToken).expect(423);
  });

  it('RN07 e RN08 - o RSVP do grupo fecha no expirado pela função única: 409 SITE_EXPIRED e nada gravado', async () => {
    const { weddingId, slug, party, cookie, from } = await scenario();
    const body = await answer(slug, cookie);
    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'expired', endDate: date(-10), graceUntil: date(-3), expiredAt: date(-2) },
    });

    const refused = await rsvp(slug, cookie, from, body).expect(409);
    expect(refused.body.error).toBe('SITE_EXPIRED');
    expect(await db.party.findUniqueOrThrow({ where: { id: party.id } })).toMatchObject({
      version: 1,
      lastResponseActor: null,
    });
  });

  it('RN07 - envios no expirado: 409 SITE_EXPIRED; na carência, fechados como no pós-evento', async () => {
    const { ana, weddingId, party } = await scenario();
    const queue = () =>
      http()
        .get(`/v1/weddings/${weddingId}/deliveries/queue`)
        .query({ kind: 'invite', partyIds: party.id })
        .set('Cookie', ana.cookie);

    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'grace', endDate: date(-2), graceUntil: date(5) },
    });
    expect((await queue().expect(409)).body).toMatchObject({
      error: 'DELIVERIES_CLOSED',
      reason: 'post_event',
    });

    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'expired', graceUntil: date(-3), expiredAt: date(-2), endDate: date(-10) },
    });
    expect((await queue().expect(409)).body).toMatchObject({ error: 'SITE_EXPIRED' });
  });

  it('RN06 (decisão 231) - o /me traz o ciclo de vida de cada vínculo', async () => {
    const { ana, juliana, weddingId } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'grace', endDate: date(-2), graceUntil: date(5) },
    });
    for (const cookie of [ana.cookie, juliana.cookie]) {
      const me = await http().get('/v1/me').set('Cookie', cookie).expect(200);
      const membership = (me.body.memberships as { weddingId: string }[]).find(
        (item) => item.weddingId === weddingId,
      );
      expect(membership).toMatchObject({
        lifecycle: {
          status: 'grace',
          endDate: day(-2),
          graceUntil: day(5),
          expiredAt: null,
          deletionScheduledFor: null,
        },
      });
    }
  });

  it('RN08 - a função, na ordem: rascunho e inexistente not_found, bloqueado, expirado, no ar', async () => {
    const { weddingId } = await scenario();
    const state = async () =>
      (
        await db.$queryRaw<
          { state: string }[]
        >`SELECT wedding_site_state(${weddingId}::uuid) AS state`
      )[0].state;
    expect(
      (
        await db.$queryRaw<
          { state: string }[]
        >`SELECT wedding_site_state(${randomUUID()}::uuid) AS state`
      )[0].state,
    ).toBe('not_found');
    expect(await state()).toBe('live');
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'post_event' } });
    expect(await state()).toBe('live');
    await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'expired', endDate: date(-10), graceUntil: date(-3), expiredAt: date(-2) },
    });
    expect(await state()).toBe('expired');
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    expect(await state()).toBe('unavailable');
  });
});
