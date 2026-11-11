import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  PREVIEW_COOKIES,
  type PreviewCookies,
} from '../../src/modules/site/application/ports/preview-cookies.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';
const ADDRESS = 'Rua Barão de Jaguara, 1200, Centro, Campinas, SP';

/** Pré-visualização do site (S6 RN01 a RN09; Site público RN05; banco real). */
describe('Pré-visualização do site (banco real)', () => {
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
  const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const createPreview = (cookie: string, weddingId: string, body: object) =>
    http()
      .post(`/v1/weddings/${weddingId}/site-previews`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);
  const exchange = (slug: string, token: string) =>
    http()
      .post(`/v1/sites/${slug}/preview-session`)
      .set('Origin', SITE_ORIGIN)
      .set('X-Forwarded-For', ip())
      .send({ token });
  const site = (slug: string, cookie?: string) => {
    const call = http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const changeMode = (slug: string, cookie: string, body: object) =>
    http()
      .patch(`/v1/sites/${slug}/preview-session`)
      .set('Origin', SITE_ORIGIN)
      .set('Cookie', cookie)
      .send(body);
  const parties = (slug: string, cookie?: string, q?: string) => {
    const call = http()
      .get(`/v1/sites/${slug}/preview-parties`)
      .query(q ? { q } : {})
      .set('Origin', SITE_ORIGIN);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const tokenOf = (url: string) => new URL(url).searchParams.get('previa') as string;
  const cookieOf = (response: request.Response) =>
    ([] as string[]).concat(response.headers['set-cookie'] ?? []);

  /** O rascunho de Ana e Marcos, com a Cerimônia, o contato e dois grupos. */
  async function draftWedding() {
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
      data: { slug, contactWhatsapp: '+5519998764521' },
    });
    await db.sectionContent.updateMany({
      where: { weddingId, section: { type: 'ceremony' } },
      data: {
        content: {
          venues: [
            { title: 'Cerimônia', placeName: 'Capela', date: null, time: null, address: ADDRESS },
          ],
        },
      },
    });
    const party = (name: string) =>
      db.party.create({
        data: { weddingId, name, linkToken: randomBytes(16).toString('base64url') },
      });
    const [moreira, duarte] = [await party('Família Moreira'), await party('Família Duarte')];
    return { ana, juliana, weddingId, slug, moreira, duarte };
  }

  /** Pede o token no app e troca pelo cookie no site; devolve o cabeçalho Cookie. */
  async function openPreview(
    { cookie, weddingId, slug }: { cookie: string; weddingId: string; slug: string },
    body: object = { mode: 'visitor' },
  ): Promise<string> {
    const { url } = (await createPreview(cookie, weddingId, body).expect(201)).body as {
      url: string;
    };
    const response = await exchange(slug, tokenOf(url)).expect(200);
    return cookieOf(response)[0].split(';')[0];
  }

  it('RN01 e RN02 - o app recebe a url do site com o token de 128 bits, que fica só em hash e vale 5 minutos', async () => {
    const { ana, weddingId, slug } = await draftWedding();
    const before = Date.now();

    const response = await createPreview(ana.cookie, weddingId, { mode: 'visitor' }).expect(201);

    const { url, expiresAt } = response.body as { url: string; expiresAt: string };
    expect(url).toMatch(new RegExp(`^${SITE_ORIGIN}/${slug}\\?previa=[A-Za-z0-9_-]{22}$`));
    expect(new Date(expiresAt).getTime() - before).toBeGreaterThan(4.9 * 60 * 1000);
    expect(new Date(expiresAt).getTime() - before).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    expect(response.headers['cache-control']).toBe('no-store');
    const stored = await db.sitePreviewToken.findFirstOrThrow({ where: { weddingId } });
    expect(stored.tokenHash).toBe(createHash('sha256').update(tokenOf(url)).digest('hex'));
    expect(stored).toMatchObject({
      userId: ana.userId,
      mode: 'visitor',
      partyId: null,
      usedAt: null,
    });
  });

  it('RN02 e RN09 - modo grupo: o grupo é obrigatório, do casamento e fora da lixeira', async () => {
    const { ana, weddingId, moreira } = await draftWedding();
    const other = await draftWedding();

    await createPreview(ana.cookie, weddingId, { mode: 'party' }).expect(400);
    await createPreview(ana.cookie, weddingId, { mode: 'escondido' }).expect(400);
    const foreign = await createPreview(ana.cookie, weddingId, {
      mode: 'party',
      partyId: other.moreira.id,
    }).expect(404);
    expect(foreign.body.error).toBe('PARTY_NOT_FOUND');
    await db.party.update({ where: { id: moreira.id }, data: { deletedAt: new Date() } });
    await createPreview(ana.cookie, weddingId, { mode: 'party', partyId: moreira.id }).expect(404);
  });

  it('RN03 - troca o token pelo cookie da prévia (30 minutos fixos, só nas rotas do site); o token vale uma vez só', async () => {
    const wedding = await draftWedding();
    const { url } = (
      await createPreview(wedding.ana.cookie, wedding.weddingId, {
        mode: 'party',
        partyId: wedding.moreira.id,
      }).expect(201)
    ).body as { url: string };
    const before = Date.now();

    const response = await exchange(wedding.slug, tokenOf(url)).expect(200);

    expect(response.body).toEqual({
      slug: wedding.slug,
      mode: 'party',
      party: { id: wedding.moreira.id, name: 'Família Moreira' },
    });
    const [cookie] = cookieOf(response);
    expect(cookie).toMatch(new RegExp(`^kore_site_preview_${wedding.weddingId}=[^;]+;`));
    expect(cookie).toContain('Path=/v1/sites');
    expect(cookie).toContain('HttpOnly');
    const expires = new Date(/Expires=([^;]+)/.exec(cookie)?.[1] ?? '').getTime();
    expect(expires - before).toBeGreaterThan(29 * 60 * 1000);
    expect(expires - before).toBeLessThanOrEqual(30 * 60 * 1000 + 1000);
    expect(response.headers['cache-control']).toBe('private, no-store');

    const again = await exchange(wedding.slug, tokenOf(url)).expect(404);
    expect(again.body.error).toBe('PREVIEW_INVALID');
    expect(cookieOf(again)).toEqual([]);
  });

  it('RN04 - token vencido, de outro endereço ou de quem perdeu o vínculo: PREVIEW_INVALID, sem cookie', async () => {
    const wedding = await draftWedding();
    const other = await draftWedding();
    const token = async (cookie: string, weddingId: string) =>
      tokenOf(
        (
          (await createPreview(cookie, weddingId, { mode: 'visitor' }).expect(201)).body as {
            url: string;
          }
        ).url,
      );

    const expired = await token(wedding.ana.cookie, wedding.weddingId);
    await db.sitePreviewToken.updateMany({
      where: { weddingId: wedding.weddingId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await exchange(wedding.slug, expired).expect(404);

    await exchange(other.slug, await token(wedding.ana.cookie, wedding.weddingId)).expect(404);

    const fromJuliana = await token(wedding.juliana.cookie, wedding.weddingId);
    await db.membership.updateMany({
      where: { weddingId: wedding.weddingId, userId: wedding.juliana.userId },
      data: { removedAt: new Date() },
    });
    const lost = await exchange(wedding.slug, fromJuliana).expect(404);
    expect(lost.body.error).toBe('PREVIEW_INVALID');
    await exchange(wedding.slug, randomBytes(16).toString('base64url')).expect(404);
  });

  it('RN05 - com o cookie, o rascunho aparece: como visitante, o recorte do visitante; sem cookie, SITE_DRAFT', async () => {
    const wedding = await draftWedding();
    const cookie = await openPreview({ cookie: wedding.ana.cookie, ...wedding });

    const { body } = await site(wedding.slug, cookie).expect(200);

    expect(body).toMatchObject({
      slug: wedding.slug,
      names: 'Ana & Marcos',
      viewer: { kind: 'preview', party: null, preview: { as: 'visitor' } },
      contact: null,
    });
    expect(body.sections).toContainEqual({
      type: 'ceremony',
      title: 'Cerimônia & Recepção',
      locked: true,
    });
    expect(JSON.stringify(body)).not.toContain(ADDRESS);
    expect((await site(wedding.slug).expect(404)).body.error).toBe('SITE_DRAFT');
  });

  it('RN05 e RN07 - como grupo: a faixa, os locais e o contato; vale mais que o cookie de um grupo; não grava visita', async () => {
    const wedding = await draftWedding();
    const cookie = await openPreview(
      { cookie: wedding.ana.cookie, ...wedding },
      { mode: 'party', partyId: wedding.duarte.id },
    );

    const { body } = await site(
      wedding.slug,
      `${cookie}; kore_party_${wedding.weddingId}=qualquer`,
    ).expect(200);

    expect(body).toMatchObject({
      viewer: { kind: 'preview', party: { name: 'Família Duarte' }, preview: { as: 'party' } },
      contact: { whatsapp: '+5519998764521', email: null },
    });
    expect(JSON.stringify(body)).toContain(ADDRESS);
    expect(
      (await db.party.findUniqueOrThrow({ where: { id: wedding.duarte.id } })).firstViewedAt,
    ).toBeNull();
  });

  it('RN06 e RN08 - a barra troca o modo e regrava o cookie com o mesmo vencimento', async () => {
    const wedding = await draftWedding();
    const cookie = await openPreview({ cookie: wedding.ana.cookie, ...wedding });

    const changed = await changeMode(wedding.slug, cookie, {
      mode: 'party',
      partyId: wedding.moreira.id,
    }).expect(200);

    expect(changed.body).toEqual({
      mode: 'party',
      party: { id: wedding.moreira.id, name: 'Família Moreira' },
    });
    const [rewritten] = cookieOf(changed);
    const asParty = await site(wedding.slug, rewritten.split(';')[0]).expect(200);
    expect(asParty.body.viewer).toMatchObject({ party: { name: 'Família Moreira' } });
    const verify = (value: string) =>
      app
        .get<PreviewCookies>(PREVIEW_COOKIES)
        .verify({ weddingId: wedding.weddingId, value: value.split('=')[1] });
    expect(verify(rewritten.split(';')[0])?.expiresAt).toEqual(verify(cookie)?.expiresAt);

    await changeMode(wedding.slug, cookie, { mode: 'party' }).expect(400);
    const other = await draftWedding();
    expect(
      (
        await changeMode(wedding.slug, cookie, { mode: 'party', partyId: other.moreira.id }).expect(
          404,
        )
      ).body.error,
    ).toBe('PARTY_NOT_FOUND');
    expect(
      (await changeMode(wedding.slug, 'kore_session=x', { mode: 'visitor' }).expect(401)).body
        .error,
    ).toBe('PREVIEW_REQUIRED');
  });

  it('RN06 - os grupos do Select: em ordem, sem acento na busca, sem a lixeira, com o total', async () => {
    const wedding = await draftWedding();
    await db.party.create({
      data: {
        weddingId: wedding.weddingId,
        name: 'DUÁRTE Neto',
        linkToken: randomBytes(16).toString('base64url'),
      },
    });
    await db.party.create({
      data: {
        weddingId: wedding.weddingId,
        name: 'Duarte na lixeira',
        linkToken: randomBytes(16).toString('base64url'),
        deletedAt: new Date(),
      },
    });
    const cookie = await openPreview({ cookie: wedding.ana.cookie, ...wedding });

    const all = await parties(wedding.slug, cookie).expect(200);
    const found = await parties(wedding.slug, cookie, 'duarte').expect(200);

    expect((all.body.data as { name: string }[]).map(({ name }) => name)).toEqual([
      'DUÁRTE Neto',
      'Família Duarte',
      'Família Moreira',
    ]);
    expect(all.body.total).toBe(3);
    expect(found.body).toMatchObject({ total: 2 });
    expect(all.headers['cache-control']).toBe('private, no-store');
    expect((await parties(wedding.slug).expect(401)).body.error).toBe('PREVIEW_REQUIRED');
  });

  it('RN03 e RN05 - o cookie de outro casamento é ignorado; vencido ou sem vínculo, a leitura segue sem prévia', async () => {
    const wedding = await draftWedding();
    const other = await draftWedding();
    const cookie = await openPreview({ cookie: wedding.ana.cookie, ...wedding });

    expect((await site(other.slug, cookie).expect(404)).body.error).toBe('SITE_DRAFT');
    await parties(other.slug, cookie).expect(401);

    const cookies = app.get<PreviewCookies>(PREVIEW_COOKIES);
    const expired = `${cookies.name({ weddingId: wedding.weddingId })}=${cookies.sign({
      weddingId: wedding.weddingId,
      claims: {
        userId: wedding.ana.userId,
        mode: 'visitor',
        partyId: null,
        expiresAt: new Date(Date.now() - 1000),
      },
    })}`;
    await site(wedding.slug, expired).expect(404);

    const fromJuliana = await openPreview({ cookie: wedding.juliana.cookie, ...wedding });
    await db.membership.updateMany({
      where: { weddingId: wedding.weddingId, userId: wedding.juliana.userId },
      data: { removedAt: new Date() },
    });
    await site(wedding.slug, fromJuliana).expect(404);
    await parties(wedding.slug, fromJuliana).expect(401);
  });
});
