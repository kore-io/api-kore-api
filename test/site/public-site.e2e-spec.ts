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
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const SITE_ORIGIN = 'http://localhost:5174';
const ADDRESS = 'Rua Barão de Jaguara, 1200, Centro, Campinas, SP';
const PLACE = 'Capela Nossa Senhora das Graças';
const WHATSAPP = '+5519998764521';

/**
 * O site público como visitante (Site público RN02 a RN05, RN09 e RN13): um
 * casamento publicado criado no próprio teste (a publicação só chega na F4), e
 * a resposta da API conferida, além dos cabeçalhos.
 */
describe('Site público do casal: visitante e prévia do link (banco real)', () => {
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

  const site = (slug: string) =>
    request(app.getHttpServer()).get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);
  const linkPreview = (slug: string) =>
    request(app.getHttpServer()).get(`/v1/public/sites/${slug}/preview`);

  async function readyImage(weddingId: string): Promise<string> {
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
      },
    });
    return id;
  }

  async function content(weddingId: string, type: string, enabled: boolean, value: object) {
    await db.section.updateMany({ where: { weddingId, type: type as never }, data: { enabled } });
    await db.sectionContent.updateMany({
      where: { weddingId, section: { type: type as never } },
      data: { content: value },
    });
  }

  /** O casamento de Ana e Marcos, publicado, com o site preenchido. */
  async function publishedWedding({
    status = 'published',
    eventDate = new Date('2026-11-14T00:00:00Z'),
  }: {
    status?: 'published' | 'draft' | 'awaiting_couple';
    eventDate?: Date | null;
  } = {}) {
    const ana = await signedInUser({ app, name: 'Ana' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const slug = `ana-e-marcos-${randomUUID().slice(0, 8)}`;
    const [cover, photo, failed] = [
      await readyImage(weddingId),
      await readyImage(weddingId),
      uuidV7(),
    ];
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        slug,
        status,
        publishedAt: status === 'published' ? new Date() : null,
        eventDate,
        coverImageId: cover,
        contactWhatsapp: WHATSAPP,
        contactEmail: 'casal@exemplo.kore.local',
      },
    });
    await db.partner.updateMany({
      where: { weddingId, slot: 1 },
      data: { displayName: 'Ana Beatriz Moreira' },
    });
    await db.partner.updateMany({
      where: { weddingId, slot: 2 },
      data: { displayName: 'Marcos Vinícius Rocha' },
    });
    await content(weddingId, 'story', true, {
      text: 'Nos conhecemos na faculdade.',
      imageIds: [failed, photo],
    });
    await content(weddingId, 'ceremony', true, {
      venues: [
        {
          title: 'Cerimônia',
          placeName: PLACE,
          date: '2026-11-14',
          time: '16:30',
          address: ADDRESS,
        },
      ],
    });
    // Ligada e vazia: não aparece.
    await content(weddingId, 'lodging', true, { text: '' });
    // Desligada com conteúdo: não aparece.
    await content(weddingId, 'dress_code', false, { text: 'Esporte fino', imageId: null });
    await content(weddingId, 'faq', true, {
      items: [{ question: 'E se chover?', answer: 'A cerimônia vai para o salão.' }],
    });
    return { ana, weddingId, slug, cover, photo };
  }

  it('RN05 e RN13 - o visitante vê o site sem local, horário nem contato: o recorte vem da API', async () => {
    const { slug, cover, photo } = await publishedWedding();

    const response = await site(slug.toUpperCase()).expect(200);

    const image = (id: string) => ({
      url: storage.publicUrl({ key: `site/${id}/display.jpg` }),
      thumbUrl: storage.publicUrl({ key: `site/${id}/thumb.jpg` }),
      width: 2560,
      height: 1707,
    });
    expect(response.body).toEqual({
      slug,
      names: 'Ana & Marcos',
      eventDate: '2026-11-14',
      city: 'Campinas',
      state: 'SP',
      timezone: 'America/Sao_Paulo',
      appearance: {
        fontPairKey: 'romantico',
        primaryColor: '#A94F37',
        primaryForeground: '#FFFFFF',
        accentColor: '#7A8B69',
        backgroundMode: 'cream',
      },
      cover: { url: image(cover).url, width: 2560, height: 1707 },
      viewer: { kind: 'visitor', party: null, preview: null },
      contact: null,
      sections: [
        { type: 'countdown' },
        {
          type: 'story',
          title: 'Nossa história',
          content: { text: 'Nos conhecemos na faculdade.', images: [image(photo)] },
        },
        { type: 'ceremony', title: 'Cerimônia & Recepção', locked: true },
        {
          type: 'faq',
          title: 'Perguntas frequentes',
          content: {
            items: [{ question: 'E se chover?', answer: 'A cerimônia vai para o salão.' }],
          },
        },
      ],
    });
    const raw = JSON.stringify(response.body);
    for (const secret of [ADDRESS, PLACE, '16:30', WHATSAPP, 'casal@exemplo'])
      expect(raw).not.toContain(secret);
  });

  it('RN02, RN03 e RN07 - sem cache, fora dos buscadores, com CORS só para a origem do site', async () => {
    const { slug } = await publishedWedding();

    const response = await site(slug).expect(200);

    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(response.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);
  });

  it('Seções RN06 - sem data, a contagem não aparece', async () => {
    const { slug } = await publishedWedding({ eventDate: null });

    const { body } = await site(slug).expect(200);

    expect((body.sections as { type: string }[]).map(({ type }) => type)).toEqual([
      'story',
      'ceremony',
      'faq',
    ]);
  });

  it('RN04 - rascunho: SITE_DRAFT sem dado nenhum; endereço que não existe: SITE_NOT_FOUND; os mesmos cabeçalhos', async () => {
    const draft = await publishedWedding({ status: 'draft' });
    const awaiting = await publishedWedding({ status: 'awaiting_couple' });

    for (const { slug } of [draft, awaiting]) {
      const response = await site(slug).expect(404);
      expect(response.body).toEqual({
        statusCode: 404,
        error: 'SITE_DRAFT',
        message: expect.any(String),
      });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    }
    expect((await site(`nao-existe-${randomUUID().slice(0, 8)}`).expect(404)).body.error).toBe(
      'SITE_NOT_FOUND',
    );
  });

  it('RN07 - a sessão do casal, vinda do site, é ignorada: a dona vê como visitante', async () => {
    const { ana, slug } = await publishedWedding();

    const { body } = await site(slug).set('Cookie', ana.cookie).expect(200);

    expect(body).toMatchObject({ viewer: { kind: 'visitor' }, contact: null });
  });

  it('RN09 - a prévia do link: publicado com a og.jpg da capa; rascunho e endereço inexistente iguais e genéricos', async () => {
    const published = await publishedWedding();
    const draft = await publishedWedding({ status: 'draft' });

    const ok = await linkPreview(published.slug).expect(200);
    const fromDraft = await linkPreview(draft.slug).expect(200);
    const unknown = await linkPreview(`nao-existe-${randomUUID().slice(0, 8)}`).expect(200);

    expect(ok.body).toEqual({
      state: 'published',
      title: 'Ana & Marcos',
      description: 'Site do casamento de Ana & Marcos.',
      image: {
        url: storage.publicUrl({ key: `site/${published.cover}/og.jpg` }),
        width: 1200,
        height: 630,
      },
    });
    const generic = { state: 'generic', title: null, description: null, image: null };
    expect(fromDraft.body).toEqual(generic);
    expect(unknown.body).toEqual(generic);
    expect(ok.headers['cache-control']).toBe('public, max-age=300');
    expect(ok.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(JSON.stringify(ok.body)).not.toContain('2026-11-14');
    await linkPreview('ana_e_marcos').expect(400);
  });
});
