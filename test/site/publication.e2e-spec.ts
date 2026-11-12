import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import type { Env } from '../../src/shared/config/env.schema';
import { WeddingPseudonymizer } from '../../src/modules/product-events/infrastructure/wedding-pseudonymizer';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const DAY_MS = 86_400_000;

/** Publicação por Cortesia (Publicação RN01 a RN07, RN09 e RN11; banco real). */
describe('Publicação por Cortesia (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = (target = app) => request(target.getHttpServer());
  const publish = (cookie: string, weddingId: string, body: unknown, target = app) =>
    http(target)
      .post(`/v1/weddings/${weddingId}/publication`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body as object);
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

  it('RN04, RN05 e RN07 - publicar escolhendo a data de saída do ar', async () => {
    const { ana, weddingId, eventDate } = await anaWedding();
    const endDate = inDays(100);
    const before = Date.now();

    const response = await publish(ana.cookie, weddingId, { endDate }).expect(200);

    expect(response.body).toEqual({
      status: 'published',
      publishedAt: expect.any(String),
      endDate,
      publicationSource: 'courtesy',
    });
    const published = await wedding(weddingId);
    expect(published).toMatchObject({
      status: 'published',
      publicationSource: 'courtesy',
      publishedByUserId: ana.userId,
      endDate: new Date(`${endDate}T00:00:00Z`),
      // A Cortesia não é pagamento (decisão 217(4)).
      paidThrough: null,
    });
    expect(published.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [log] = await db.applicationLog.findMany({
      where: { weddingId, action: 'wedding.published' },
    });
    expect(log).toMatchObject({ actorUserId: ana.userId, data: { courtesy: true } });
    // O evento sai depois do commit, com os dias até o casamento no fuso dele.
    const expectedDays = Math.round(
      (Date.parse(`${eventDate}T00:00:00Z`) -
        Date.parse(`${localDate({ at: new Date(), timezone: 'America/Sao_Paulo' })}T00:00:00Z`)) /
        DAY_MS,
    );
    const weddingRef = app.get(WeddingPseudonymizer).weddingRef({ weddingId });
    const events = await db.productEvent.findMany({ where: { weddingRef, name: 'publicado' } });
    expect(events).toEqual([
      expect.objectContaining({ props: { dias_ate_casamento: expectedDays } }),
    ]);
  });

  it('RN01 e RN04 - a leitura do Editor traz a chave e os limites calculados no servidor', async () => {
    const { ana, weddingId } = await anaWedding({ eventDate: '2026-11-14' });

    expect((await editor(ana.cookie, weddingId)).body.publication).toEqual({
      courtesyEnabled: true,
      endDateMin: '2026-11-15',
      endDateMax: '2027-11-14',
    });

    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: new Date('2028-02-29T00:00:00Z') },
    });
    expect((await editor(ana.cookie, weddingId)).body.publication).toMatchObject({
      endDateMax: '2029-02-28',
    });

    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: null } });
    expect((await editor(ana.cookie, weddingId)).body.publication).toEqual({
      courtesyEnabled: true,
      endDateMin: null,
      endDateMax: null,
    });
  });

  it('RN04 - data fora do limite: 422 com os limites, e o casamento continua em rascunho', async () => {
    const { ana, weddingId } = await anaWedding({ eventDate: inDays(30) });

    for (const endDate of [inDays(30), inDays(30 + 400)]) {
      const response = await publish(ana.cookie, weddingId, { endDate }).expect(422);
      expect(response.body).toMatchObject({
        error: 'END_DATE_OUT_OF_RANGE',
        endDateMin: inDays(31),
        endDateMax: expect.any(String),
      });
    }
    const invalid = await publish(ana.cookie, weddingId, { endDate: '14/02/2027' }).expect(400);
    expect(invalid.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'endDate' })]),
    );
    expect((await wedding(weddingId)).status).toBe('draft');
  });

  // Sem UF (fuso) e sem endereço o banco já não deixa (chk_weddings_tombstone):
  // esses dois ramos ficam no unitário do caso de uso.
  it('RN04 - sem data não publica: EVENT_DATE_MISSING', async () => {
    const { ana, weddingId } = await anaWedding({ eventDate: null });

    await publish(ana.cookie, weddingId, { endDate: inDays(100) })
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('EVENT_DATE_MISSING'));
  });

  it('RN02 - a colaboradora não publica: ACTION_NOT_ALLOWED', async () => {
    const { juliana, weddingId } = await anaWedding();

    await publish(juliana.cookie, weddingId, { endDate: inDays(100) })
      .expect(403)
      .expect(({ body }) => expect(body.error).toBe('ACTION_NOT_ALLOWED'));
    expect((await wedding(weddingId)).status).toBe('draft');
  });

  it('RN03 - casamento aguardando o casal não publica: NOT_DRAFT', async () => {
    const { ana, weddingId } = await anaWedding();
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'awaiting_couple' } });

    await publish(ana.cookie, weddingId, { endDate: inDays(100) })
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('NOT_DRAFT'));
  });

  it('RN05 - duas publicações ao mesmo tempo: uma publica, a outra recebe NOT_DRAFT', async () => {
    const { ana, weddingId } = await anaWedding();
    const endDate = inDays(100);

    const statuses = (
      await Promise.all([
        publish(ana.cookie, weddingId, { endDate }),
        publish(ana.cookie, weddingId, { endDate }),
      ])
    )
      .map((response) => response.status)
      .sort();

    expect(statuses).toEqual([200, 409]);
    expect(
      await db.applicationLog.count({ where: { weddingId, action: 'wedding.published' } }),
    ).toBe(1);
  });

  it('RN01 - com a Cortesia desligada: COURTESY_DISABLED, e a leitura diz que está desligada', async () => {
    const disabled = await createTestApp({
      override: (builder) =>
        builder.overrideProvider(AppConfigService).useFactory({
          inject: [ConfigService],
          factory: (config: ConfigService<Env, true>) => {
            const service = new AppConfigService(config);
            const get = service.get.bind(service);
            service.get = (({ key }: { key: keyof Env }) =>
              key === 'COURTESY_PUBLICATION_ENABLED' ? false : get({ key })) as typeof service.get;
            return service;
          },
        }),
    });
    try {
      const { ana, weddingId } = await anaWedding();
      await publish(ana.cookie, weddingId, { endDate: inDays(100) }, disabled)
        .expect(409)
        .expect(({ body }) => expect(body.error).toBe('COURTESY_DISABLED'));
      const read = await http(disabled)
        .get(`/v1/weddings/${weddingId}/site`)
        .set('Cookie', ana.cookie)
        .expect(200);
      expect(read.body.publication.courtesyEnabled).toBe(false);
      expect((await wedding(weddingId)).status).toBe('draft');
    } finally {
      await disabled.close();
    }
  });

  it('RN06 - depois de publicar, o endereço não muda mais', async () => {
    const { ana, weddingId } = await anaWedding();
    await publish(ana.cookie, weddingId, { endDate: inDays(100) }).expect(200);

    await http()
      .patch(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ slug: `outro-${randomUUID().slice(0, 8)}` })
      .expect(409)
      .expect(({ body }) => expect(body.error).toBe('SLUG_LOCKED'));
  });

  it('RN11 - num casamento publicado, a data nova não deixa a saída do ar fora dos limites', async () => {
    const { ana, weddingId, eventDate } = await anaWedding({ eventDate: inDays(30) });
    await publish(ana.cookie, weddingId, { endDate: inDays(60) }).expect(200);
    const patch = (body: Record<string, unknown>) =>
      http()
        .patch(`/v1/weddings/${weddingId}/site`)
        .set('Cookie', ana.cookie)
        .set('Origin', APP_ORIGIN)
        .send(body);

    // A data depois da saída do ar: a saída ficaria antes do casamento.
    const response = await patch({ eventDate: inDays(90) }).expect(422);
    expect(response.body).toMatchObject({
      error: 'END_DATE_OUT_OF_RANGE',
      endDateMin: inDays(91),
    });
    // Tirar a data também é recusado: sem data, não há limite.
    await patch({ eventDate: null }).expect(422);
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
    await publish(ana.cookie, weddingId, { endDate: inDays(100) }).expect(200);

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
