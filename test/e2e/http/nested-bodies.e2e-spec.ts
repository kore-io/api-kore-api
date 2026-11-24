import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/harness/create-test-app';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Objeto aninhado no corpo (decisão 319): o `@ValidateNested` sozinho deixa
 * passar o objeto ausente, em lista ou, numa lista de objetos, um item que é
 * outra lista. Cada rota com corpo aninhado responde 400, nunca 500.
 */
describe('Corpos com objeto aninhado: ausente ou em lista dá 400 (decisão 319; banco real)', () => {
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
  const send = (
    method: 'post' | 'put' | 'patch',
    path: string,
    cookie: string,
    body: unknown,
    origin = APP_ORIGIN,
  ) =>
    http()
      [method](path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body as object);
  const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
  const slug = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

  /** Espera 400 em cada corpo, com o pedido no erro quando não for. */
  async function expect400(
    call: (body: unknown) => request.Test,
    bodies: unknown[],
  ): Promise<void> {
    for (const body of bodies) {
      const response = await call(body);
      if (response.status !== 400)
        throw new Error(
          `Esperava 400 com ${JSON.stringify(body)}, veio ${response.status}: ${JSON.stringify(response.body)}`,
        );
    }
  }

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    return { ana, weddingId };
  }

  it('E-mail e push RN07 - as chaves da assinatura ausentes, em lista ou como texto', async () => {
    const { cookie } = await signedInUser({ app });
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    const keys = { p256dh: 'BPk', auth: 'aut' };
    await expect400(
      (body) => send('post', '/v1/me/push-subscriptions', cookie, body),
      [{ endpoint }, { endpoint, keys: [keys] }, { endpoint, keys: [] }, { endpoint, keys: 'x' }],
    );
  });

  it('Cadastro do casal (Simule RN10) - a aparência em lista ou como texto', async () => {
    const { cookie } = await signedInUser({ app, name: 'Ana' });
    const base = {
      myName: 'Ana Beatriz Moreira',
      myTitle: 'bride',
      partnerName: 'Marcos Vinícius Rocha',
      eventDate: day(120),
      city: 'Campinas',
      state: 'SP',
      termsVersion: '2026-09',
    };
    await expect400(
      (body) => send('post', '/v1/weddings', cookie, body),
      [
        { ...base, slug: slug('ana'), appearance: [] },
        { ...base, slug: slug('ana'), appearance: [{ fontPair: 'classic' }] },
        { ...base, slug: slug('ana'), appearance: 'x' },
      ],
    );
  });

  it('Novo casamento RN03 - a aparência em lista ou como texto', async () => {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const base = {
      partner1Name: 'Fernanda Alves',
      partner2Name: 'João Lima',
      eventDate: day(120),
      city: 'Campinas',
      state: 'SP',
    };
    await expect400(
      (body) => send('post', '/v1/me/weddings', cookie, body),
      [
        { ...base, slug: slug('fernanda'), appearance: [] },
        { ...base, slug: slug('fernanda'), appearance: [{ fontPair: 'classic' }] },
      ],
    );
  });

  it('Importação colada - um grupo que é lista, nulo ou texto', async () => {
    const { ana, weddingId } = await anaWedding();
    const group = { name: 'Família Moreira', guests: ['Célia Moreira'] };
    await expect400(
      (body) => send('post', `/v1/weddings/${weddingId}/guest-imports/paste`, ana.cookie, body),
      [[[group]], [null], ['x']].map((groups) => ({ groups, removedInPreview: 0 })),
    );
    expect(await db.party.count({ where: { weddingId } })).toBe(0);
  });

  it('Convidados RN03 e RN09 - criar e editar grupo com um convidado que é lista ou nulo', async () => {
    const { ana, weddingId } = await anaWedding();
    const guest = { name: 'Célia Moreira', ageGroup: 'adult' };
    await expect400(
      (body) => send('post', `/v1/weddings/${weddingId}/parties`, ana.cookie, body),
      [[[guest]], [null]].map((guests) => ({ name: 'Família Moreira', guests })),
    );
    const created = await send('post', `/v1/weddings/${weddingId}/parties`, ana.cookie, {
      name: 'Família Moreira',
      guests: [guest],
    }).expect(201);
    await expect400(
      (body) =>
        send('patch', `/v1/weddings/${weddingId}/parties/${created.body.id}`, ana.cookie, body),
      [{ guests: [[guest]] }, { guests: [null] }],
    );
  });

  it('Modelos do cerimonialista - o FAQ com uma pergunta que é lista', async () => {
    const { userId } = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const cookie = await openSession({ app, userId });
    const question = { question: 'Pode levar criança?', answer: 'Pode.' };
    await expect400(
      (body) => send('post', '/v1/me/planner-templates', cookie, body),
      [[[question]], [null]].map((questions) => ({
        kind: 'faq',
        name: 'Perguntas de sempre',
        content: { questions },
      })),
    );
  });

  it('Editor do site - um local da cerimônia, uma pergunta do FAQ ou um noivo que é lista', async () => {
    const { ana, weddingId } = await anaWedding();
    const section = (type: string, content: object) =>
      send('put', `/v1/weddings/${weddingId}/site/sections/${type}`, ana.cookie, {
        enabled: true,
        title: 'Título',
        content,
      });
    const venue = {
      title: 'Cerimônia',
      placeName: 'Capela',
      date: day(120),
      time: null,
      address: 'Rua das Flores, 10',
    };
    await expect400((body) => section('ceremony', body as object), [{ venues: [[venue]] }]);
    await expect400(
      (body) => section('faq', body as object),
      [{ items: [[{ question: 'Pode levar criança?', answer: 'Pode.' }]] }],
    );
    const partner = await db.partner.findFirstOrThrow({ where: { weddingId, slot: 1 } });
    await expect400(
      (body) => send('patch', `/v1/weddings/${weddingId}/site`, ana.cookie, body),
      [{ partners: [[{ id: partner.id, name: 'Ana' }]] }, { partners: [null] }],
    );
  });

  it('RSVP RN04 - a resposta com um convidado que é lista ou nulo', async () => {
    const { ana, weddingId } = await anaWedding();
    const siteSlug = slug('ana-e-marcos');
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug: siteSlug,
        eventDate: new Date(`${day(60)}T00:00:00Z`),
        status: 'published',
        publishedAt: new Date(),
        endDate: new Date(`${day(90)}T00:00:00Z`),
        publicationSource: 'courtesy',
      },
    });
    const created = await send('post', `/v1/weddings/${weddingId}/parties`, ana.cookie, {
      name: 'Família Moreira',
      guests: [{ name: 'Célia Moreira', ageGroup: 'adult' }],
    }).expect(201);
    const party = await db.party.findUniqueOrThrow({ where: { id: created.body.id as string } });
    const from = `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 250)).join('.')}`;
    const session = await http()
      .post(`/v1/sites/${siteSlug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', from)
      .send({ token: party.linkToken })
      .expect(200);
    const cookie = ([] as string[]).concat(session.headers['set-cookie'])[0].split(';')[0];
    const form = await http()
      .get(`/v1/sites/${siteSlug}/rsvp`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .expect(200);
    const celia = (form.body.guests as { id: string }[])[0];
    const answer = { id: celia.id, status: 'confirmed' };
    // Sem o @IsObject, a lista dentro da lista já dava 400, mas pela regra do
    // grupo (GUEST_NOT_IN_PARTY); agora quem barra é a validação do corpo.
    for (const guests of [[[answer]], [null]]) {
      const response = await http()
        .put(`/v1/sites/${siteSlug}/rsvp`)
        .set('Origin', SITE_ORIGIN)
        .set('Cookie', cookie)
        .set('X-Forwarded-For', from)
        .send({ version: form.body.party.version as number, signedByGuestId: celia.id, guests })
        .expect(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([{ path: 'guests', code: 'IS_OBJECT', params: {} }]),
      );
    }
    expect(await db.rsvpSubmission.count({ where: { weddingId } })).toBe(0);
  });
});
