import { uuidV7 } from '../../src/shared/ids/uuid-v7';
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

type PartyGuest = { id: string; name: string | null; isPlusOne: boolean; rsvpStatus: string };

/** Prazo de resposta e respostas pelo casal (Prazo RN01 a RN07; banco real). */
describe('Prazo de resposta e respostas pelo casal (banco real)', () => {
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
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;

  /** Ana (dona) e Juliana (colaboradora); casamento publicado em 60 dias. */
  async function scenario({ status = 'published' }: { status?: 'published' | 'draft' } = {}) {
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
        status,
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        ...(status === 'published'
          ? {
              publishedAt: new Date(),
              endDate: new Date(`${day(90)}T00:00:00Z`),
              publicationSource: 'courtesy' as const,
            }
          : {}),
      },
    });
    const createParty = async (body: Record<string, unknown>) =>
      (
        await http()
          .post(`/v1/weddings/${weddingId}/parties`)
          .set('Cookie', ana.cookie)
          .set('Origin', APP_ORIGIN)
          .send(body)
          .expect(201)
      ).body as { id: string; guests: PartyGuest[] };
    return { ana, juliana, weddingId, slug, createParty };
  }

  const deadline = (cookie: string, weddingId: string, rsvpDeadline: string | null) =>
    http()
      .put(`/v1/weddings/${weddingId}/rsvp-deadline`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send({ rsvpDeadline });
  const alter = (cookie: string, weddingId: string, guestId: string, body: object) =>
    http()
      .put(`/v1/weddings/${weddingId}/guests/${guestId}/response`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const party = async (cookie: string, weddingId: string, partyId: string) =>
    (
      await http()
        .get(`/v1/weddings/${weddingId}/parties/${partyId}`)
        .set('Cookie', cookie)
        .expect(200)
    ).body as { version: number; guests: PartyGuest[]; history: Record<string, unknown>[] };
  const byName = (guests: PartyGuest[], name: string) => guests.find((g) => g.name === name)!;

  it('RN01 e RN02 - definir, mudar e tirar o prazo; quem pode é qualquer vínculo', async () => {
    const { ana, juliana, weddingId } = await scenario();

    await deadline(ana.cookie, weddingId, day(10))
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ rsvpDeadline: day(10) }));
    // Hoje vale (no fuso do casamento).
    await deadline(juliana.cookie, weddingId, day(0)).expect(200);
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).rsvpDeadline).toEqual(
      new Date(`${day(0)}T00:00:00Z`),
    );

    await deadline(ana.cookie, weddingId, null).expect(200);
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).rsvpDeadline,
    ).toBeNull();
  });

  it('RN01 - prazo depois do casamento ou no passado é recusado; sem data do casamento, só o passado vale', async () => {
    const { ana, weddingId } = await scenario();

    const after = await deadline(ana.cookie, weddingId, day(61)).expect(422);
    expect(after.body).toMatchObject({ error: 'DEADLINE_AFTER_EVENT', eventDate: day(60) });
    const past = await deadline(ana.cookie, weddingId, day(-1)).expect(422);
    expect(past.body.error).toBe('DEADLINE_IN_PAST');

    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: null } });
    await deadline(ana.cookie, weddingId, day(200)).expect(200);
  });

  it('RN03 - reabrir: com o prazo vencido o grupo não responde; a data nova reabre, sem mexer no status nem nas respostas', async () => {
    const { ana, weddingId, slug, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }],
    });
    const stored = await db.party.findUniqueOrThrow({ where: { id: created.id } });
    const from = ip();
    const session = await http()
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send({ token: stored.linkToken })
      .expect(200);
    const cookie = ([] as string[]).concat(session.headers['set-cookie'])[0].split(';')[0];
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date(`${day(-1)}T00:00:00Z`) },
    });
    const celia = created.guests[0].id;
    const answer = (version: number) =>
      http()
        .put(`/v1/sites/${slug}/rsvp`)
        .set('Origin', SITE_ORIGIN)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', from)
        .send({ version, signedByGuestId: celia, guests: [{ id: celia, status: 'confirmed' }] });
    await answer(1).expect(409);
    const before = await db.party.findUniqueOrThrow({ where: { id: created.id } });

    await deadline(ana.cookie, weddingId, day(5)).expect(200);

    const unchanged = await db.party.findUniqueOrThrow({ where: { id: created.id } });
    expect(unchanged).toMatchObject({
      deliveryStatus: before.deliveryStatus,
      version: before.version,
    });
    await answer(1).expect(200);
  });

  it('RN02, RN07 e T5 - a fila do lembrete: enviados com convidado com nome pendente; a vaga não conta', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const sent = async (name: string, body: Record<string, unknown> = {}) => {
      const created = await createParty({ name, guests: [{ name: `${name} 1` }], ...body });
      await db.party.update({
        where: { id: created.id },
        data: { deliveryStatus: 'sent', sentAt: new Date() },
      });
      return created;
    };
    await sent('Família Moreira');
    await sent('Família Duarte');
    await createParty({ name: 'Tio Jorge', guests: [{ name: 'Jorge' }] });
    const carla = await sent('Carla e Rafael', { plusOneSlots: 1 });
    // Respondido, com a vaga pendente.
    await db.guest.updateMany({
      where: { partyId: carla.id, name: { not: null } },
      data: { rsvpStatus: 'confirmed', respondedAt: new Date() },
    });
    await db.party.update({ where: { id: carla.id }, data: { deliveryStatus: 'responded' } });

    const list = await http()
      .get(`/v1/weddings/${weddingId}/parties`)
      .query({ remind: 'true' })
      .set('Cookie', ana.cookie)
      .expect(200);

    expect(list.body.total).toBe(2);
    expect((list.body.data as { name: string }[]).map((item) => item.name)).toEqual([
      'Família Duarte',
      'Família Moreira',
    ]);
  });

  it('RN04 - o casal altera depois do prazo: os números mudam, o histórico mostra quem alterou e não há notificação', async () => {
    const { ana, juliana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [
        { name: 'Célia Moreira', ageGroup: 'adult' },
        { name: 'Pedro Moreira', ageGroup: 'child' },
      ],
    });
    const pedro = byName(created.guests, 'Pedro Moreira').id;
    await alter(ana.cookie, weddingId, pedro, { version: 1, status: 'confirmed' }).expect(200);
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date(`${day(-1)}T00:00:00Z`) },
    });
    const before = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });

    // A colaboradora, depois do prazo: 403.
    const denied = await alter(juliana.cookie, weddingId, pedro, {
      version: 2,
      status: 'declined',
    });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('ACTION_NOT_ALLOWED');

    const response = await alter(ana.cookie, weddingId, pedro, {
      version: 2,
      status: 'declined',
    }).expect(200);

    expect(response.body).toEqual({ partyId: created.id, version: 3 });
    const after = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
    expect({
      confirmed: after.confirmed - before.confirmed,
      declined: after.declined - before.declined,
    }).toEqual({ confirmed: -1, declined: 1 });
    const panel = await party(ana.cookie, weddingId, created.id);
    expect(panel.version).toBe(3);
    expect(panel.history[0]).toMatchObject({
      kind: 'response',
      actor: 'couple',
      actorName: 'Ana',
      signedBy: null,
      guest: { name: 'Pedro Moreira', status: 'declined' },
    });
    expect(await db.notification.count({ where: { weddingId } })).toBe(0);
    expect(
      await db.applicationLog.count({ where: { weddingId, action: 'guest.response_changed' } }),
    ).toBe(2);
  });

  it('RN04 e RN07 - a colaboradora antes do prazo altera, e a lista mostra "alterada por Juliana"', async () => {
    const { ana, juliana, weddingId, createParty } = await scenario();
    await deadline(ana.cookie, weddingId, day(10)).expect(200);
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Pedro Moreira' }],
    });

    await alter(juliana.cookie, weddingId, created.guests[0].id, {
      version: 1,
      status: 'confirmed',
    }).expect(200);

    const list = await http()
      .get(`/v1/weddings/${weddingId}/parties`)
      .set('Cookie', ana.cookie)
      .expect(200);
    const item = (list.body.data as Record<string, unknown>[]).find(
      (row) => row.id === created.id,
    )!;
    expect(item.lastResponse).toEqual({
      actor: 'couple',
      signedByName: null,
      actorName: 'Juliana Prado',
    });
    expect(item.respondedAt).not.toBeNull();
  });

  it('RN04 e decisão 217(2) - grupo não enviado, em rascunho: o casal marca e o grupo fica respondido', async () => {
    const { ana, weddingId, createParty } = await scenario({ status: 'draft' });
    const created = await createParty({ name: 'Tio Jorge', guests: [{ name: 'Jorge' }] });

    await alter(ana.cookie, weddingId, created.guests[0].id, {
      version: 1,
      status: 'confirmed',
    }).expect(200);

    const stored = await db.party.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored).toMatchObject({
      deliveryStatus: 'responded',
      lastResponseActor: 'couple',
      lastResponseUserId: ana.userId,
    });
    expect(stored.respondedAt).not.toBeNull();
  });

  it('RN04 e R3-7 - o grupo mudou com o Dialog aberto: RSVP_CHANGED com a versão atual', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Pedro Moreira' }],
    });
    await db.party.update({ where: { id: created.id }, data: { version: 4 } });

    const response = await alter(ana.cookie, weddingId, created.guests[0].id, {
      version: 1,
      status: 'confirmed',
    }).expect(409);
    expect(response.body).toMatchObject({ error: 'RSVP_CHANGED', current: { version: 4 } });
  });

  it('RN04 - a vaga: Vai com o nome dá nome ao acompanhante; sem nome, 400; o nome não vai em quem já tem nome', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }],
      plusOneSlots: 1,
    });
    const slot = created.guests.find((guest) => guest.isPlusOne)!;

    const empty = await alter(ana.cookie, weddingId, slot.id, { version: 1, status: 'confirmed' });
    expect(empty.status).toBe(400);
    expect(empty.body.errors).toEqual([{ path: 'name', code: 'IS_NOT_EMPTY', params: {} }]);
    const renamed = await alter(ana.cookie, weddingId, created.guests[0].id, {
      version: 1,
      status: 'confirmed',
      name: 'Outra',
    });
    expect(renamed.body.errors).toEqual([{ path: 'name', code: 'NAME_NOT_ALLOWED', params: {} }]);

    await alter(ana.cookie, weddingId, slot.id, {
      version: 1,
      status: 'confirmed',
      name: 'Rita Souza',
    }).expect(200);
    expect(await db.guest.findUniqueOrThrow({ where: { id: slot.id } })).toMatchObject({
      name: 'Rita Souza',
      rsvpStatus: 'confirmed',
      isPlusOne: true,
    });
  });

  it('RN04 - Não vai apaga a restrição e a música; o casal não muda a música', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }],
    });
    const celia = created.guests[0].id;
    await db.guest.update({
      where: { id: celia },
      data: {
        rsvpStatus: 'confirmed',
        dietaryRestriction: 'sem glúten',
        songSuggestion: 'Evidências',
        songSuggestedAt: new Date(),
      },
    });

    await alter(ana.cookie, weddingId, celia, {
      version: 1,
      status: 'confirmed',
      dietaryRestriction: 'vegana',
    }).expect(200);
    expect((await db.guest.findUniqueOrThrow({ where: { id: celia } })).songSuggestion).toBe(
      'Evidências',
    );

    await alter(ana.cookie, weddingId, celia, { version: 2, status: 'declined' }).expect(200);
    expect(await db.guest.findUniqueOrThrow({ where: { id: celia } })).toMatchObject({
      rsvpStatus: 'declined',
      dietaryRestriction: null,
      songSuggestion: null,
      songSuggestedAt: null,
    });
  });

  it('RN05 - o histórico do grupo: envios, a visita e a resposta do grupo, da mais nova para a mais antiga, sem a restrição', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }, { name: 'Luiz Moreira' }],
    });
    const celia = byName(created.guests, 'Célia Moreira').id;
    await db.partyDelivery.create({
      data: {
        weddingId,
        partyId: created.id,
        kind: 'invite',
        channel: 'whatsapp',
        createdAt: new Date('2026-09-02T22:10:00Z'),
      },
    });
    await db.party.update({
      where: { id: created.id },
      data: { firstViewedAt: new Date('2026-09-03T11:22:00Z') },
    });
    await db.rsvpSubmission.create({
      data: {
        weddingId,
        partyId: created.id,
        actor: 'party',
        signedByGuestId: celia,
        confirmedCount: 2,
        declinedCount: 0,
        createdAt: new Date('2026-09-12T23:14:00Z'),
      },
    });
    await db.guest.update({ where: { id: celia }, data: { dietaryRestriction: 'sem glúten' } });

    const panel = await party(ana.cookie, weddingId, created.id);

    expect(panel.history).toEqual([
      {
        kind: 'response',
        at: '2026-09-12T23:14:00.000Z',
        actor: 'party',
        signedBy: 'Célia Moreira',
        actorName: null,
        confirmed: 2,
        declined: 0,
        guest: null,
      },
      { kind: 'viewed', at: '2026-09-03T11:22:00.000Z' },
      { kind: 'sent', at: '2026-09-02T22:10:00.000Z', channel: 'whatsapp' },
    ]);
    expect(JSON.stringify(panel.history)).not.toContain('glúten');
  });

  it('RN05 - o histórico tem no máximo 50 linhas: as mais recentes da junção dos envios e das respostas', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const created = await createParty({
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira' }],
    });
    const base = Date.parse('2026-09-01T12:00:00Z');
    const minute = 60_000;
    // 40 envios, um por minuto; 15 respostas entre eles, a cada 3 minutos e meio.
    const sentAt = Array.from({ length: 40 }, (_, index) => new Date(base + index * minute));
    const respondedAt = Array.from(
      { length: 15 },
      (_, index) => new Date(base + index * 3 * minute + 30_000),
    );
    await db.partyDelivery.createMany({
      data: sentAt.map((createdAt) => ({
        weddingId,
        partyId: created.id,
        kind: 'invite' as const,
        channel: 'whatsapp' as const,
        createdAt,
      })),
    });
    await db.rsvpSubmission.createMany({
      data: respondedAt.map((createdAt) => ({
        id: uuidV7({ now: createdAt.getTime() }),
        weddingId,
        partyId: created.id,
        actor: 'party' as const,
        confirmedCount: 1,
        declinedCount: 0,
        createdAt,
      })),
    });

    const panel = await party(ana.cookie, weddingId, created.id);

    const expected = [
      ...sentAt.map((at) => ({ kind: 'sent', at: at.toISOString() })),
      ...respondedAt.map((at) => ({ kind: 'response', at: at.toISOString() })),
    ]
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, 50);
    expect(panel.history).toHaveLength(50);
    expect(panel.history.map(({ kind, at }) => ({ kind, at }))).toEqual(expected);
  });

  it('RN06 - ao mover o pendente, o grupo fica respondido com o "Respondido em" de quem ficou', async () => {
    const { ana, weddingId, createParty } = await scenario();
    const primos = await createParty({
      name: 'Primos do Marcos',
      guests: [{ name: 'Felipe' }, { name: 'Lucas' }],
    });
    const other = await createParty({ name: 'Padrinhos', guests: [{ name: 'Leonardo' }] });
    const lucasAt = new Date('2026-09-10T15:00:00Z');
    await db.guest.update({
      where: { id: byName(primos.guests, 'Lucas').id },
      data: { rsvpStatus: 'confirmed', respondedAt: lucasAt },
    });
    await db.party.update({
      where: { id: primos.id },
      data: { deliveryStatus: 'sent', sentAt: new Date() },
    });

    await http()
      .post(`/v1/weddings/${weddingId}/guests/${byName(primos.guests, 'Felipe').id}/move`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ partyId: other.id })
      .expect(200);

    expect(await db.party.findUniqueOrThrow({ where: { id: primos.id } })).toMatchObject({
      deliveryStatus: 'responded',
      respondedAt: lucasAt,
    });
  });
});
