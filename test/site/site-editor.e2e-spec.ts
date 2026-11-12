import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../src/shared/storage/application/object-storage.port';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Editor do site: leitura e Dados básicos (S1 RN02 a RN11; S4 RN08 e RN10; banco real). */
describe('Editor do site: leitura e Dados básicos (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let storage: ObjectStorage;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    storage = app.get(OBJECT_STORAGE);
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (cookie: string, weddingId: string) =>
    request(app.getHttpServer()).get(`/v1/weddings/${weddingId}/site`).set('Cookie', cookie);
  const patch = (cookie: string, weddingId: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    // O endereço do seed (casamento-<uuid>) passa de 40: aqui, um válido.
    const slug = `casamento-${randomUUID().slice(0, 8)}`;
    await db.wedding.update({ where: { id: weddingId }, data: { slug } });
    return {
      ana,
      juliana: { ...juliana, cookie: await openSession({ app, userId: juliana.userId }) },
      weddingId,
      slug,
    };
  }

  async function readyImage(weddingId: string, unusedSince: Date | null = new Date()) {
    const id = uuidV7();
    await db.siteImage.create({
      data: {
        id,
        weddingId,
        status: 'ready',
        storageKey: `site/${id}/display.jpg`,
        thumbKey: `site/${id}/thumb.jpg`,
        ogKey: `site/${id}/og.jpg`,
        sizeBytes: 3,
        width: 2560,
        height: 1707,
        readyAt: new Date(),
        unusedSince,
      },
    });
    return id;
  }

  describe('GET …/site (RN11)', () => {
    it('RN11 - a dona lê tudo o que o Editor mostra, numa chamada', async () => {
      const { ana, weddingId, slug } = await anaWedding();

      const { body } = await get(ana.cookie, weddingId).expect(200);

      expect(body).toMatchObject({
        status: 'draft',
        publishedAt: null,
        siteUpdatedAt: null,
        partners: [
          { name: 'Ana', title: 'bride' },
          { name: 'Marcos', title: 'groom' },
        ],
        eventDate: null,
        city: 'Campinas',
        state: 'SP',
        timezone: 'America/Sao_Paulo',
        slug,
        contactWhatsapp: null,
        contactEmail: null,
        cover: null,
        appearance: {
          fontPairKey: 'romantico',
          starterPaletteKey: 'terracota',
          primaryColor: '#A94F37',
          accentColor: '#7A8B69',
          backgroundMode: 'cream',
        },
        editable: { names: true, eventDate: true, state: true, slug: true },
      });
      expect(
        (body.sections as { type: string; enabled: boolean; empty: boolean }[]).map(
          ({ type, enabled, empty }) => ({ type, enabled, empty }),
        ),
      ).toEqual([
        { type: 'story', enabled: false, empty: true },
        { type: 'countdown', enabled: true, empty: false },
        { type: 'ceremony', enabled: true, empty: true },
        { type: 'lodging', enabled: false, empty: true },
        { type: 'dress_code', enabled: false, empty: true },
        { type: 'faq', enabled: false, empty: true },
      ]);
      expect(body.sections[0].content).toEqual({ text: '', images: [] });
      expect(body.sections[4].content).toEqual({ text: '', image: null });
    });

    it('RN04 - a cerimonialista lê, mas a data, a UF e o endereço não são editáveis; sem vínculo, 404', async () => {
      const { juliana, weddingId } = await anaWedding();
      const estranha = await signedInUser({ app, name: 'Estranha' });

      const { body } = await get(juliana.cookie, weddingId).expect(200);

      expect(body.editable).toEqual({ names: true, eventDate: false, state: false, slug: false });
      expect((await get(estranha.cookie, weddingId).expect(404)).body.error).toBe(
        'WEDDING_NOT_FOUND',
      );
    });

    it('Imagens RN10 - só as imagens prontas aparecem, nas seções e na capa', async () => {
      const { ana, weddingId } = await anaWedding();
      const ready = await readyImage(weddingId);
      const failed = uuidV7();
      await db.siteImage.create({
        data: {
          id: failed,
          weddingId,
          status: 'failed',
          storageKey: `site/${failed}/display.jpg`,
          sizeBytes: 3,
        },
      });
      await db.sectionContent.updateMany({
        where: { weddingId, section: { type: 'story' } },
        data: { content: { text: '', imageIds: [failed, ready] } },
      });
      await db.wedding.update({ where: { id: weddingId }, data: { coverImageId: ready } });

      const { body } = await get(ana.cookie, weddingId).expect(200);

      const image = {
        id: ready,
        url: storage.publicUrl({ key: `site/${ready}/display.jpg` }),
        thumbUrl: storage.publicUrl({ key: `site/${ready}/thumb.jpg` }),
        width: 2560,
        height: 1707,
      };
      expect(body.cover).toEqual(image);
      expect(body.sections[0]).toMatchObject({ empty: false, content: { images: [image] } });
    });
  });

  describe('PATCH …/site (RN02 a RN10)', () => {
    it('RN02, RN06 e RN08 - a dona grava os Dados básicos: fuso pela UF, endereço em minúsculas, WhatsApp em E.164', async () => {
      const { ana, weddingId } = await anaWedding();
      const before = await get(ana.cookie, weddingId).expect(200);
      const [noiva, noivo] = before.body.partners as { id: string }[];
      const slug = `Ana-E-Marcos-${randomUUID().slice(0, 8)}`;

      const { body } = await patch(ana.cookie, weddingId, {
        partners: [
          { id: noiva.id, name: '  Ana   Beatriz Moreira ' },
          { id: noivo.id, name: 'Marcos Vinícius Rocha' },
        ],
        eventDate: '2026-11-14',
        city: 'Cuiabá',
        state: 'MT',
        slug,
        contactWhatsapp: '(19) 99876-4521',
        contactEmail: 'Casal@Exemplo.kore.local',
      }).expect(200);

      expect(body).toMatchObject({
        partners: [{ name: 'Ana Beatriz Moreira' }, { name: 'Marcos Vinícius Rocha' }],
        eventDate: '2026-11-14',
        city: 'Cuiabá',
        state: 'MT',
        timezone: 'America/Cuiaba',
        slug: slug.toLowerCase(),
        contactWhatsapp: '+5519998764521',
        contactEmail: 'casal@exemplo.kore.local',
      });
      expect(new Date(body.siteUpdatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

      // Só o enviado muda; null apaga o contato.
      const cleared = await patch(ana.cookie, weddingId, { contactWhatsapp: null }).expect(200);
      expect(cleared.body).toMatchObject({ contactWhatsapp: null, city: 'Cuiabá' });
    });

    it('RN04 - a cerimonialista grava o resto; a data, a UF e o endereço iguais passam; diferentes, 403 com os campos', async () => {
      const { juliana, weddingId, slug } = await anaWedding();

      await patch(juliana.cookie, weddingId, {
        city: 'Valinhos',
        state: 'SP',
        slug,
        eventDate: null,
      }).expect(200);
      const refused = await patch(juliana.cookie, weddingId, {
        city: 'Indaiatuba',
        eventDate: '2026-11-14',
        state: 'RJ',
        slug: `outro-${randomUUID().slice(0, 8)}`,
      }).expect(403);

      expect(refused.body).toEqual({
        statusCode: 403,
        error: 'FIELD_NOT_ALLOWED',
        message: expect.any(String),
        fields: ['eventDate', 'state', 'slug'],
      });
      expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
        city: 'Valinhos',
        state: 'SP',
        eventDate: null,
      });
    });

    it('RN04 - o vendedor muda a data antes do aceite do casal, e não depois', async () => {
      const seller = await seedReferrer({ db, kind: 'seller', name: 'Rafael Vendas' });
      const cookie = await openSession({ app, userId: seller.userId });
      const { weddingId } = await seedReferrerWedding({
        db,
        referrerUserId: seller.userId,
        referrerKind: 'seller',
        status: 'awaiting_couple',
      });

      await patch(cookie, weddingId, { eventDate: '2027-05-01' }).expect(200);
      const owner = await db.user.create({ data: { email: `${randomUUID()}@kore.local` } });
      await db.membership.create({ data: { weddingId, userId: owner.id, role: 'owner' } });

      const refused = await patch(cookie, weddingId, { eventDate: '2027-06-01' }).expect(403);
      expect(refused.body.fields).toEqual(['eventDate']);
    });

    it('RN06 e RN07 - endereço reservado (sem diferenciar maiúsculas), em uso ou fora do formato', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();

      const reserved = await patch(ana.cookie, weddingId, { slug: 'Simule' }).expect(409);
      expect(reserved.body).toMatchObject({
        error: 'SLUG_UNAVAILABLE',
        reason: 'reserved',
        suggestion: expect.stringMatching(/^simule-/),
      });
      const taken = await patch(ana.cookie, weddingId, { slug: other.slug }).expect(409);
      expect(taken.body).toMatchObject({ reason: 'taken', suggestion: expect.any(String) });
      const invalid = await patch(ana.cookie, weddingId, { slug: 'ana_e_marcos' }).expect(400);
      expect(invalid.body.errors).toEqual([
        { path: 'slug', code: 'SLUG_INVALID_FORMAT', params: {} },
      ]);
    });

    it('RN05 - publicado, o endereço não muda (409 SLUG_LOCKED); o igual passa', async () => {
      const { ana, weddingId, slug } = await anaWedding();
      await db.wedding.update({
        where: { id: weddingId },
        data: { status: 'published', publishedAt: new Date() },
      });

      await patch(ana.cookie, weddingId, { slug }).expect(200);
      const locked = await patch(ana.cookie, weddingId, {
        slug: `novo-${randomUUID().slice(0, 8)}`,
      }).expect(409);

      expect(locked.body.error).toBe('SLUG_LOCKED');
      expect((await get(ana.cookie, weddingId).expect(200)).body.editable.slug).toBe(false);
    });

    it('RN03 e RN08 - erros pelo campo: nome vazio, Partner de fora e WhatsApp curto', async () => {
      const { ana, weddingId } = await anaWedding();
      const { body } = await get(ana.cookie, weddingId).expect(200);
      const [noiva] = body.partners as { id: string }[];

      const empty = await patch(ana.cookie, weddingId, {
        partners: [{ id: noiva.id, name: '   ' }],
      }).expect(400);
      expect(empty.body.errors).toEqual([
        expect.objectContaining({ path: 'partners.0.name', code: 'IS_NOT_EMPTY' }),
      ]);
      const foreign = await patch(ana.cookie, weddingId, {
        partners: [{ id: randomUUID(), name: 'Outra' }],
        contactWhatsapp: '9999',
      }).expect(400);
      expect(foreign.body.errors).toEqual([
        { path: 'contactWhatsapp', code: 'PHONE_TOO_SHORT', params: { n: 4 } },
        { path: 'partners.0.id', code: 'PARTNER_NOT_FOUND', params: {} },
      ]);
    });

    it('RN09 e Imagens RN08 e RN10 - a capa: imagem pronta do casamento entra em uso; tirar a põe fora de uso; de outro casamento, 404', async () => {
      const { ana, weddingId } = await anaWedding();
      const other = await anaWedding();
      const cover = await readyImage(weddingId);
      const foreign = await readyImage(other.weddingId);

      const set = await patch(ana.cookie, weddingId, { coverImageId: cover }).expect(200);
      expect(set.body.cover).toMatchObject({ id: cover });
      expect(
        (await db.siteImage.findUniqueOrThrow({ where: { id: cover } })).unusedSince,
      ).toBeNull();

      await patch(ana.cookie, weddingId, { coverImageId: null }).expect(200);
      expect(
        (await db.siteImage.findUniqueOrThrow({ where: { id: cover } })).unusedSince,
      ).not.toBeNull();

      const refused = await patch(ana.cookie, weddingId, { coverImageId: foreign }).expect(404);
      expect(refused.body.error).toBe('IMAGE_NOT_FOUND');
    });
  });

  describe('GET /v1/weddings/slug-availability com o weddingId (RN06)', () => {
    it('RN06 - o endereço atual do próprio casamento volta livre; maiúsculas viram minúsculas antes de validar', async () => {
      const { ana, weddingId, slug } = await anaWedding();
      const check = (query: Record<string, string>) =>
        request(app.getHttpServer())
          .get('/v1/weddings/slug-availability')
          .query(query)
          .set('Cookie', ana.cookie)
          .expect(200);

      expect((await check({ slug, weddingId })).body).toMatchObject({ available: true });
      expect((await check({ slug })).body).toMatchObject({ available: false, reason: 'taken' });
      expect((await check({ slug: 'Simule' })).body).toMatchObject({
        slug: 'simule',
        reason: 'reserved',
      });
    });
  });
});
