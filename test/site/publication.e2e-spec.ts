import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { expectStatus, payForPublication, publishByPayment } from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

/**
 * A publicação depois da F3 (Publicação RN04, RN06, RN09 e RN11; Publicar e
 * pagar RN08 e RN17; banco real): a Cortesia saiu, e o site publicado vem do
 * pagamento confirmado pela rota dev.
 */
describe('Publicação (banco real)', () => {
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
  const publish = (cookie: string, weddingId: string, endDate: string) =>
    publishByPayment({ app, cookie, weddingId, endDate });
  const patchSite = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    http()
      .patch(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const editor = (cookie: string, weddingId: string) =>
    http().get(`/v1/weddings/${weddingId}/site`).set('Cookie', cookie).expect(200);
  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });
  /** Uma data daqui a `days` dias, AAAA-MM-DD. */
  const inDays = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

  /** Ana, dona, e Juliana, colaboradora, num rascunho com endereço, data e UF. */
  async function anaWedding({ eventDate = inDays(30) }: { eventDate?: string | null } = {}) {
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
      data: { slug, eventDate: eventDate ? new Date(`${eventDate}T00:00:00Z`) : null },
    });
    return { ana, juliana, weddingId, slug, eventDate };
  }

  it('Publicar e pagar RN17 - a rota da Cortesia saiu: 404', async () => {
    const { ana, weddingId } = await anaWedding();
    await http()
      .post(`/v1/weddings/${weddingId}/publication`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ endDate: inDays(100) })
      .expect(404);
    expect((await wedding(weddingId)).status).toBe('draft');
  });

  it('RN04 e Publicar e pagar RN17 - a leitura do Editor traz só os limites, sem a chave da Cortesia', async () => {
    const { ana, weddingId } = await anaWedding({ eventDate: '2026-11-14' });

    expect((await editor(ana.cookie, weddingId)).body.publication).toEqual({
      endDateMin: '2026-11-15',
      endDateMax: '2027-11-14',
    });

    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: new Date('2028-02-29T00:00:00Z') },
    });
    expect((await editor(ana.cookie, weddingId)).body.publication).toEqual({
      endDateMin: '2028-03-01',
      endDateMax: '2029-02-28',
    });

    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: null } });
    expect((await editor(ana.cookie, weddingId)).body.publication).toEqual({
      endDateMin: null,
      endDateMax: null,
    });
  });

  it('Publicar e pagar RN17 - o casamento publicado por Cortesia continua no ar, sem pagamento', async () => {
    const { ana, weddingId, slug } = await anaWedding();
    const endDate = inDays(100);
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        endDate: new Date(`${endDate}T00:00:00Z`),
        publicationSource: 'courtesy',
        publishedByUserId: ana.userId,
      },
    });

    await http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN).expect(200);
    const billing = await http()
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(billing.body).toMatchObject({
      status: 'published',
      publicationSource: 'courtesy',
      endDate,
      paidThrough: null,
      payments: [],
    });
  });

  it('Publicar e pagar RN08 (B2-9) - com a publicação aguardando pagamento, a data, a UF e o endereço recebem PAYMENT_PENDING', async () => {
    const { ana, weddingId } = await anaWedding();
    expectStatus(
      await payForPublication({
        app,
        cookie: ana.cookie,
        weddingId,
        endDate: inDays(100),
        method: 'pix',
      }),
      201,
    );

    for (const body of [
      { eventDate: inDays(40) },
      { state: 'RJ' },
      { slug: `outro-${randomUUID().slice(0, 8)}` },
    ]) {
      const response = await patchSite(ana.cookie, weddingId, body).expect(409);
      expect(response.body).toMatchObject({ error: 'PAYMENT_PENDING' });
    }
    // O que não muda o pagamento passa; o valor igual ao atual também (Dados básicos RN04).
    await patchSite(ana.cookie, weddingId, { city: 'Valinhos', state: 'SP' }).expect(200);
    expect((await wedding(weddingId)).city).toBe('Valinhos');
  });

  it('RN06 - depois de publicar, o endereço não muda mais', async () => {
    const { ana, weddingId } = await anaWedding();
    await publish(ana.cookie, weddingId, inDays(100));

    await patchSite(ana.cookie, weddingId, { slug: `outro-${randomUUID().slice(0, 8)}` })
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('SLUG_LOCKED'));
  });

  it('RN11 e decisão 219 - num casamento publicado, a data nova não deixa a saída do ar fora dos limites nem fica em branco', async () => {
    const { ana, weddingId, eventDate } = await anaWedding({ eventDate: inDays(30) });
    await publish(ana.cookie, weddingId, inDays(60));
    const patch = (body: Record<string, unknown>) => patchSite(ana.cookie, weddingId, body);

    // A data depois da saída do ar: a saída ficaria antes do casamento.
    const response = await patch({ eventDate: inDays(90) }).expect(422);
    expect(response.body).toMatchObject({
      error: 'END_DATE_OUT_OF_RANGE',
      endDateMin: inDays(91),
    });
    // Tirar a data: 400 com código próprio (decisão 219).
    const blank = await patch({ eventDate: null }).expect(400);
    expect(blank.body.errors).toEqual([
      { path: 'eventDate', code: 'EVENT_DATE_REQUIRED_WHEN_PUBLISHED', params: {} },
    ]);
    expect((await wedding(weddingId)).eventDate).toEqual(new Date(`${eventDate}T00:00:00Z`));

    // Uma data que mantém a saída do ar nos limites passa.
    await patch({ eventDate: inDays(20) }).expect(200);
  });

  it('RN06 e RN09 - publicado, o link do grupo identifica o grupo e o site segue fora dos buscadores', async () => {
    const { ana, weddingId, slug } = await anaWedding();
    const party = await db.party.create({
      data: {
        weddingId,
        name: 'Família Moreira',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    await publish(ana.cookie, weddingId, inDays(100));

    const session = await http()
      .post(`/v1/sites/${slug}/party-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', '10.71.4.1')
      .send({ token: party.linkToken })
      .expect(200);
    expect(session.body.party).toEqual({ name: 'Família Moreira' });

    const site = await http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN).expect(200);
    expect(site.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
