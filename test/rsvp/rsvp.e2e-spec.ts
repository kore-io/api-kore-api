import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { WeddingPseudonymizer } from '../../src/modules/product-events/infrastructure/wedding-pseudonymizer';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

type Guest = {
  id: string;
  name: string | null;
  isPlusOne: boolean;
  rsvpStatus: string;
  dietaryRestriction: string | null;
  songSuggestion: string | null;
};
type Form = {
  party: { id: string; name: string; version: number };
  guests: Guest[];
  state: string;
  rsvpDeadline: string | null;
  songQuestion: { enabled: boolean; text: string };
  contact: { whatsapp: string | null; email: string | null };
  plusOneSlots: number;
};

/** Confirmar presença (RSVP RN01 a RN14; banco real). */
describe('Confirmar presença (banco real)', () => {
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
  // Cada grupo com o próprio IP, para o limite por IP e grupo não somar entre casos.
  const ip = () => `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);

  /** Ana & Marcos publicado, com a Família Moreira (Célia, Luiz, Pedro e 1 vaga). */
  async function scenario({ songQuestionEnabled = false }: { songQuestionEnabled?: boolean } = {}) {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status: 'published',
        publishedAt: new Date(Date.now() - 10 * DAY_MS),
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        endDate: new Date(`${day(90)}T00:00:00Z`),
        publicationSource: 'courtesy',
        contactWhatsapp: '+5519998764521',
        songQuestionEnabled,
      },
    });
    const createParty = async (body: Record<string, unknown>) => {
      const created = await http()
        .post(`/v1/weddings/${weddingId}/parties`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send(body)
        .expect(201);
      const party = await db.party.findUniqueOrThrow({ where: { id: created.body.id } });
      const from = ip();
      const session = await http()
        .post(`/v1/sites/${slug}/party-session`)
        .set('Origin', SITE_ORIGIN)
        .set('X-Forwarded-For', from)
        .send({ token: party.linkToken })
        .expect(200);
      const cookie = ([] as string[]).concat(session.headers['set-cookie'])[0].split(';')[0];
      return { party, cookie, from };
    };
    const moreira = await createParty({
      name: 'Família Moreira',
      guests: [
        { name: 'Célia Moreira', ageGroup: 'adult' },
        { name: 'Luiz Moreira', ageGroup: 'adult' },
        { name: 'Pedro Moreira', ageGroup: 'child' },
      ],
      plusOneSlots: 1,
    });
    return { ana, weddingId, slug, createParty, moreira };
  }

  const get = (slug: string, cookie?: string) => {
    const call = http().get(`/v1/sites/${slug}/rsvp`).set('Origin', SITE_ORIGIN);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const put = (
    slug: string,
    { cookie, from }: { cookie: string; from: string },
    body: Record<string, unknown>,
  ) =>
    http()
      .put(`/v1/sites/${slug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .set('X-Forwarded-For', from)
      .send(body);
  const form = async (slug: string, cookie: string) =>
    (await get(slug, cookie).expect(200)).body as Form;
  const byName = (guests: Guest[], name: string) => guests.find((guest) => guest.name === name)!;
  const slotOf = (guests: Guest[]) => guests.find((guest) => guest.isPlusOne)!;

  /** As respostas da Família Moreira: Célia Vou com "sem glúten", Luiz Vou e Pedro Não vou. */
  async function answer(slug: string, moreira: { cookie: string; from: string }) {
    const current = await form(slug, moreira.cookie);
    const celia = byName(current.guests, 'Célia Moreira');
    return {
      current,
      celia,
      body: {
        version: current.party.version,
        signedByGuestId: celia.id,
        guests: [
          { id: celia.id, status: 'confirmed', dietaryRestriction: 'sem glúten' },
          { id: byName(current.guests, 'Luiz Moreira').id, status: 'confirmed' },
          { id: byName(current.guests, 'Pedro Moreira').id, status: 'declined' },
        ],
      },
    };
  }

  it('RN03 - o grupo identificado lê o formulário com a versão, o prazo, a música e o contato', async () => {
    const { slug, moreira } = await scenario();

    const response = await get(slug, moreira.cookie).expect(200);

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
    const body = response.body as Form;
    expect(body).toMatchObject({
      party: { id: moreira.party.id, name: 'Família Moreira', version: 1 },
      plusOneSlots: 1,
      rsvpDeadline: null,
      state: 'open',
      songQuestion: { enabled: false, text: 'Que música não pode faltar na festa?' },
      contact: { whatsapp: '+5519998764521', email: null },
    });
    expect(body.guests.map((guest) => [guest.name, guest.isPlusOne, guest.rsvpStatus])).toEqual([
      ['Célia Moreira', false, 'pending'],
      ['Luiz Moreira', false, 'pending'],
      ['Pedro Moreira', false, 'pending'],
      [null, true, 'pending'],
    ]);
  });

  it('RN03, RN06, RN07 e RN09 - responder pelo grupo: o grupo fica respondido, os números mudam e o casal é avisado sem a restrição', async () => {
    const { ana, weddingId, slug, moreira } = await scenario();
    const { celia, body } = await answer(slug, moreira);
    const before = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });

    const response = await put(slug, moreira, body).expect(200);

    expect(response.body.party.version).toBe(2);
    expect(byName(response.body.guests, 'Célia Moreira').dietaryRestriction).toBe('sem glúten');
    const party = await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } });
    expect(party).toMatchObject({
      version: 2,
      // Não enviado e respondido: a resposta leva a responded (decisão 217(2)).
      deliveryStatus: 'responded',
      lastResponseActor: 'party',
      lastSignedByGuestId: celia.id,
      lastResponseUserId: null,
    });
    expect(party.respondedAt).not.toBeNull();
    const after = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
    expect({
      confirmed: after.confirmed - before.confirmed,
      declined: after.declined - before.declined,
      pending: after.pending - before.pending,
      adultsConfirmed: after.adultsConfirmed - before.adultsConfirmed,
      // A vaga sem resposta segura o grupo como pendente nos números (RN05).
      partiesPending: after.partiesPending - before.partiesPending,
    }).toEqual({ confirmed: 2, declined: 1, pending: -3, adultsConfirmed: 2, partiesPending: 0 });
    const [submission] = await db.rsvpSubmission.findMany({ where: { partyId: party.id } });
    expect(submission).toMatchObject({
      actor: 'party',
      signedByGuestId: celia.id,
      confirmedCount: 2,
      declinedCount: 1,
    });
    expect(await db.guestResponse.count({ where: { submissionId: submission.id } })).toBe(3);
    const notifications = await db.notification.findMany({ where: { weddingId } });
    expect(notifications).toEqual([
      expect.objectContaining({
        userId: ana.userId,
        type: 'rsvp',
        groupKey: `rsvp:${weddingId}`,
        count: 1,
        readAt: null,
        payload: [
          {
            partyId: party.id,
            name: 'Família Moreira',
            confirmed: 2,
            declined: 1,
            at: submission.createdAt.toISOString(),
          },
        ],
      }),
    ]);
    // RN12: a restrição não vai na notificação nem no log.
    expect(JSON.stringify(notifications)).not.toContain('glúten');
    const ipLogs = await db.accessIpLog.findMany({
      where: { partyId: party.id, action: 'rsvp.answered' },
    });
    expect(ipLogs).toEqual([expect.objectContaining({ actorKind: 'party', ip: moreira.from })]);
  });

  it('RN07 e decisão 217(5) - a primeira resposta do casamento grava o evento uma vez só', async () => {
    const { weddingId, slug, moreira, createParty } = await scenario();
    const duarte = await createParty({
      name: 'Família Duarte',
      guests: [{ name: 'Carla Duarte' }],
    });
    const weddingRef = app.get(WeddingPseudonymizer).weddingRef({ weddingId });

    await put(slug, moreira, (await answer(slug, moreira)).body).expect(200);
    const carla = (await form(slug, duarte.cookie)).guests[0];
    await put(slug, duarte, {
      version: 1,
      signedByGuestId: carla.id,
      guests: [{ id: carla.id, status: 'confirmed' }],
    }).expect(200);

    const events = await db.productEvent.findMany({
      where: { weddingRef, name: 'primeira_resposta' },
    });
    expect(events).toEqual([expect.objectContaining({ props: { dias_desde_publicacao: 10 } })]);
    // A segunda resposta soma na notificação não lida (Central RN04).
    const [notification] = await db.notification.findMany({ where: { weddingId } });
    expect(notification.count).toBe(2);
    expect((notification.payload as { name: string }[]).map((entry) => entry.name)).toEqual([
      'Família Moreira',
      'Família Duarte',
    ]);
  });

  it('RN05 - levar acompanhante: Vou levar com o nome conta como confirmado; sem o nome, 400', async () => {
    const { slug, moreira } = await scenario();
    const { current, body } = await answer(slug, moreira);
    const slot = slotOf(current.guests);

    const missing = await put(slug, moreira, {
      ...body,
      guests: [...body.guests, { id: slot.id, status: 'confirmed', name: '  ' }],
    }).expect(400);
    expect(missing.body.errors).toEqual([
      { path: 'guests.3.name', code: 'IS_NOT_EMPTY', params: {} },
    ]);

    const response = await put(slug, moreira, {
      ...body,
      guests: [...body.guests, { id: slot.id, status: 'confirmed', name: ' Rita Souza ' }],
    }).expect(200);
    expect(slotOf(response.body.guests)).toMatchObject({
      name: 'Rita Souza',
      rsvpStatus: 'confirmed',
    });

    // Não vou levar apaga o nome e a restrição da vaga.
    const declined = await put(slug, moreira, {
      ...body,
      version: 2,
      guests: [...body.guests, { id: slot.id, status: 'declined', name: 'Rita Souza' }],
    }).expect(200);
    expect(slotOf(declined.body.guests)).toMatchObject({ name: null, rsvpStatus: 'declined' });
  });

  it('RN04, RN06 e R2-5 - envio malformado: 400 com os códigos por caminho, e nada é gravado', async () => {
    const { slug, moreira, createParty } = await scenario();
    const { current, celia, body } = await answer(slug, moreira);
    const [luiz, pedro] = [
      byName(current.guests, 'Luiz Moreira'),
      byName(current.guests, 'Pedro Moreira'),
    ];
    const duarte = await createParty({
      name: 'Família Duarte',
      guests: [{ name: 'Carla Duarte' }],
    });
    const carla = (await form(slug, duarte.cookie)).guests[0];
    const errors = async (payload: Record<string, unknown>): Promise<unknown> =>
      ((await put(slug, moreira, payload).expect(400)).body as { errors: unknown }).errors;

    // Falta o Pedro.
    expect(await errors({ ...body, guests: body.guests.slice(0, 2) })).toEqual([
      { path: 'guests', code: 'ANSWER_MISSING', params: { guestId: pedro.id } },
    ]);
    // Luiz repetido, pendente ou com nome (só a vaga ganha nome; Crivo no PR 2).
    expect(
      await errors({ ...body, guests: [...body.guests, { id: luiz.id, status: 'confirmed' }] }),
    ).toEqual([{ path: 'guests.3.id', code: 'DUPLICATE_GUEST', params: {} }]);
    expect(
      await errors({
        ...body,
        guests: [body.guests[0], { id: luiz.id, status: 'pending' }, body.guests[2]],
      }),
    ).toEqual([{ path: 'guests.1.status', code: 'PENDING_NOT_ALLOWED', params: {} }]);
    expect(
      await errors({
        ...body,
        guests: [
          body.guests[0],
          { id: luiz.id, status: 'confirmed', name: 'Outro' },
          body.guests[2],
        ],
      }),
    ).toEqual([{ path: 'guests.1.name', code: 'NAME_NOT_ALLOWED', params: {} }]);
    // Quem assina é de outro grupo; o convidado é de outro grupo.
    expect(await errors({ ...body, signedByGuestId: carla.id })).toEqual([
      { path: 'signedByGuestId', code: 'SIGNER_INVALID', params: {} },
    ]);
    expect(
      await errors({ ...body, guests: [...body.guests, { id: carla.id, status: 'confirmed' }] }),
    ).toEqual([{ path: 'guests.3.id', code: 'GUEST_NOT_IN_PARTY', params: {} }]);
    // A vaga não assina.
    expect(await errors({ ...body, signedByGuestId: slotOf(current.guests).id })).toEqual([
      { path: 'signedByGuestId', code: 'SIGNER_INVALID', params: {} },
    ]);
    // Tamanhos.
    expect(
      await errors({
        ...body,
        guests: [
          { id: celia.id, status: 'confirmed', dietaryRestriction: 'a'.repeat(201) },
          ...body.guests.slice(1),
        ],
      }),
    ).toEqual([{ path: 'guests.0.dietaryRestriction', code: 'TOO_LONG', params: { max: 200 } }]);

    expect(await db.rsvpSubmission.count({ where: { partyId: moreira.party.id } })).toBe(0);
    expect((await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } })).version).toBe(1);
  });

  it('RN07 e RN09 - alterar até o prazo guarda as duas respostas; mudar só a restrição não muda o "Respondido em"', async () => {
    const { slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);
    await put(slug, moreira, body).expect(200);
    const firstTime = (await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } }))
      .respondedAt;
    const pedroId = body.guests[2].id;

    await put(slug, moreira, {
      ...body,
      version: 2,
      guests: [body.guests[0], body.guests[1], { id: pedroId, status: 'confirmed' }],
    }).expect(200);
    expect(
      (
        await db.guestResponse.findMany({
          where: { guestId: pedroId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((row) => row.status),
    ).toEqual(['declined', 'confirmed']);
    const changedAt = (await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } }))
      .respondedAt;
    expect(changedAt!.getTime()).toBeGreaterThanOrEqual(firstTime!.getTime());

    // Só a restrição de Célia.
    await put(slug, moreira, {
      ...body,
      version: 3,
      guests: [
        { ...body.guests[0], dietaryRestriction: 'vegetariana' },
        body.guests[1],
        { id: pedroId, status: 'confirmed' },
      ],
    }).expect(200);
    const party = await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } });
    expect(party.respondedAt).toEqual(changedAt);
    expect(party.version).toBe(4);
    expect(await db.rsvpSubmission.count({ where: { partyId: party.id } })).toBe(3);

    // Enviar de novo sem mudança: nada é gravado e a versão fica.
    const same = await put(slug, moreira, {
      ...body,
      version: 4,
      guests: [
        { ...body.guests[0], dietaryRestriction: 'vegetariana' },
        body.guests[1],
        { id: pedroId, status: 'confirmed' },
      ],
    }).expect(200);
    expect(same.body.party.version).toBe(4);
    expect(await db.rsvpSubmission.count({ where: { partyId: party.id } })).toBe(3);
  });

  it('RN07 - duas pessoas do grupo ao mesmo tempo: a segunda recebe RSVP_CHANGED com as respostas atuais', async () => {
    const { slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);
    await put(slug, moreira, body).expect(200);

    const late = await put(slug, moreira, {
      ...body,
      guests: [body.guests[0], body.guests[1], { id: body.guests[2].id, status: 'confirmed' }],
    }).expect(409);

    expect(late.body.error).toBe('RSVP_CHANGED');
    expect(late.body.current.party.version).toBe(2);
    expect(byName(late.body.current.guests, 'Pedro Moreira').rsvpStatus).toBe('declined');
  });

  it('RN07 e RN11 - o RSVP e o mover de grupo ao mesmo tempo terminam sem deadlock', async () => {
    const { ana, weddingId, slug, moreira, createParty } = await scenario();
    await createParty({ name: 'Família Duarte', guests: [{ name: 'Carla Duarte' }] });
    const duarte = await db.party.findFirstOrThrow({
      where: { weddingId, name: 'Família Duarte' },
    });
    const { body } = await answer(slug, moreira);

    const [rsvp, move] = await Promise.all([
      put(slug, moreira, body),
      http()
        .post(`/v1/weddings/${weddingId}/guests/${body.guests[2].id}/move`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send({ partyId: duarte.id }),
    ]);

    expect(move.status).toBe(200);
    // Quem chegou depois respeita a versão nova: ou o RSVP gravou antes do
    // mover, ou recebe RSVP_CHANGED (ou a falta do Pedro, se já saiu).
    expect([200, 400, 409]).toContain(rsvp.status);
    const stats = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });
    const guests = await db.guest.findMany({ where: { weddingId, deletedAt: null } });
    expect(stats.confirmed).toBe(guests.filter((guest) => guest.rsvpStatus === 'confirmed').length);
    expect(stats.pending).toBe(guests.filter((guest) => guest.rsvpStatus === 'pending').length);
  });

  it('RN08 - depois do prazo: só leitura, e o PUT recebe RSVP_CLOSED com o motivo', async () => {
    const { weddingId, slug, moreira } = await scenario();
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date(`${day(-2)}T00:00:00Z`) },
    });
    const current = await form(slug, moreira.cookie);
    expect(current).toMatchObject({ state: 'deadline_passed', rsvpDeadline: day(-2) });

    const response = await put(slug, moreira, (await answer(slug, moreira)).body).expect(409);
    expect(response.body).toMatchObject({ error: 'RSVP_CLOSED', reason: 'deadline_passed' });

    // No dia do prazo ainda vale (até as 23h59 no fuso do casamento).
    await db.wedding.update({
      where: { id: weddingId },
      data: { rsvpDeadline: new Date(`${day(1)}T00:00:00Z`) },
    });
    expect((await form(slug, moreira.cookie)).state).toBe('open');
  });

  it('RN08 - no pós-evento: só leitura, e o PUT recebe RSVP_CLOSED post_event', async () => {
    const { weddingId, slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'post_event' } });

    expect((await form(slug, moreira.cookie)).state).toBe('post_event');
    const response = await put(slug, moreira, body).expect(409);
    expect(response.body).toMatchObject({ error: 'RSVP_CLOSED', reason: 'post_event' });
  });

  it('RN10 - teto por grupo: com 50 gravações hoje, a próxima com mudança recebe RSVP_LIMIT; sem mudança, passa', async () => {
    const { weddingId, slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);
    await db.rsvpSubmission.createMany({
      data: Array.from({ length: 50 }, () => ({
        id: uuidV7(),
        weddingId,
        partyId: moreira.party.id,
        actor: 'party' as const,
        confirmedCount: 0,
        declinedCount: 0,
      })),
    });

    const response = await put(slug, moreira, body).expect(429);
    expect(response.body.error).toBe('RSVP_LIMIT');
    expect((await db.party.findUniqueOrThrow({ where: { id: moreira.party.id } })).version).toBe(1);

    // Gravações de ontem não contam.
    await db.rsvpSubmission.updateMany({
      where: { partyId: moreira.party.id },
      data: { createdAt: new Date(Date.now() - 2 * DAY_MS) },
    });
    await put(slug, moreira, body).expect(200);
  });

  it('RN10 - 20 gravações por minuto por IP e grupo: acima, RSVP_RATE_LIMITED', async () => {
    const { slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);
    await put(slug, moreira, body).expect(200);
    const same = { ...body, version: 2 };

    for (let index = 0; index < 19; index++) await put(slug, moreira, same).expect(200);
    const response = await put(slug, moreira, same).expect(429);

    expect(response.body.error).toBe('RSVP_RATE_LIMITED');
    // Outro IP, mesmo grupo: não é afetado.
    await put(slug, { ...moreira, from: ip() }, same).expect(200);
  });

  it('RN11 - link regenerado ou grupo na lixeira no meio da resposta: 401 PARTY_SESSION_INVALID', async () => {
    const { ana, weddingId, slug, moreira, createParty } = await scenario();
    const { body } = await answer(slug, moreira);

    await http()
      .post(`/v1/weddings/${weddingId}/parties/${moreira.party.id}/regenerate-link`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .expect((response) => expect(response.status).toBeLessThan(300));
    const regenerated = await put(slug, moreira, body).expect(401);
    expect(regenerated.body.error).toBe('PARTY_SESSION_INVALID');

    const duarte = await createParty({
      name: 'Família Duarte',
      guests: [{ name: 'Carla Duarte' }],
    });
    const carla = (await form(slug, duarte.cookie)).guests[0];
    await db.party.update({ where: { id: duarte.party.id }, data: { deletedAt: new Date() } });
    await put(slug, duarte, {
      version: 1,
      signedByGuestId: carla.id,
      guests: [{ id: carla.id, status: 'confirmed' }],
    }).expect(401);
  });

  it('RN13 - PUT com o cookie do grupo e sem Origin: 403 ORIGIN_NOT_ALLOWED', async () => {
    const { slug, moreira } = await scenario();
    const { body } = await answer(slug, moreira);

    const response = await http()
      .put(`/v1/sites/${slug}/rsvp`)
      .set('Cookie', moreira.cookie)
      .set('X-Forwarded-For', moreira.from)
      .send(body)
      .expect(403);
    expect(response.body.error).toBe('ORIGIN_NOT_ALLOWED');
  });

  it('RN01 - o visitante não chega ao RSVP: sem o cookie do grupo, 401', async () => {
    const { slug } = await scenario();

    const response = await get(slug).expect(401);
    expect(response.body.error).toBe('PARTY_SESSION_INVALID');
  });

  it('RN01 - a prévia como grupo lê o formulário com state preview; o PUT é PREVIEW_READ_ONLY e nada é gravado', async () => {
    const { ana, weddingId, slug, moreira } = await scenario();
    const { url } = (
      await http()
        .post(`/v1/weddings/${weddingId}/site-previews`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send({ mode: 'party', partyId: moreira.party.id })
        .expect(201)
    ).body as { url: string };
    const exchanged = await http()
      .post(`/v1/sites/${slug}/preview-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', ip())
      .send({ token: new URL(url).searchParams.get('previa') })
      .expect(200);
    const preview = ([] as string[]).concat(exchanged.headers['set-cookie'])[0].split(';')[0];

    const read = (await get(slug, preview).expect(200)).body as Form;
    expect(read).toMatchObject({ state: 'preview', party: { name: 'Família Moreira' } });

    const { body } = await answer(slug, moreira);
    const response = await put(slug, { cookie: preview, from: ip() }, body).expect(403);
    expect(response.body.error).toBe('PREVIEW_READ_ONLY');
    expect(await db.rsvpSubmission.count({ where: { partyId: moreira.party.id } })).toBe(0);
  });

  it('Música RN04 - a sugestão só de quem confirma; Não vou apaga; desligada, o campo é ignorado e a guardada fica', async () => {
    const { weddingId, slug, moreira } = await scenario({ songQuestionEnabled: true });
    const { body } = await answer(slug, moreira);
    const withSong = {
      ...body,
      guests: [
        { ...body.guests[0], songSuggestion: ' Evidências ' },
        body.guests[1],
        { ...body.guests[2], songSuggestion: 'Ignorada' },
      ],
    };

    await put(slug, moreira, withSong).expect(200);
    const celiaId = body.guests[0].id;
    const celia = await db.guest.findUniqueOrThrow({ where: { id: celiaId } });
    expect(celia.songSuggestion).toBe('Evidências');
    expect(celia.songSuggestedAt).not.toBeNull();
    expect(
      (await db.guest.findUniqueOrThrow({ where: { id: body.guests[2].id } })).songSuggestion,
    ).toBeNull();

    // Desligada: o campo novo é ignorado, e a sugestão guardada fica.
    await db.wedding.update({ where: { id: weddingId }, data: { songQuestionEnabled: false } });
    await put(slug, moreira, {
      ...withSong,
      version: 2,
      guests: [
        { ...withSong.guests[0], songSuggestion: 'Outra', dietaryRestriction: 'vegana' },
        ...withSong.guests.slice(1),
      ],
    }).expect(200);
    expect((await db.guest.findUniqueOrThrow({ where: { id: celiaId } })).songSuggestion).toBe(
      'Evidências',
    );

    // Não vou apaga a sugestão na mesma escrita (o CHECK do banco).
    await put(slug, moreira, {
      ...body,
      version: 3,
      guests: [{ id: celiaId, status: 'declined' }, ...body.guests.slice(1)],
    }).expect(200);
    expect(await db.guest.findUniqueOrThrow({ where: { id: celiaId } })).toMatchObject({
      rsvpStatus: 'declined',
      songSuggestion: null,
      songSuggestedAt: null,
      dietaryRestriction: null,
    });
  });
});
