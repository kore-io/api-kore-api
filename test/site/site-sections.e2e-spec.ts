import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Seções do site (S3 RN04 a RN13; S4 RN08 e RN10; banco real). */
describe('Seções do site (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const put = (cookie: string, weddingId: string, type: string, body: object) =>
    request(app.getHttpServer())
      .put(`/v1/weddings/${weddingId}/site/sections/${type}`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  async function anaWedding() {
    const ana = await signedInUser({ app, name: 'Ana' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    return { ana, juliana, weddingId };
  }

  const stored = async (weddingId: string, type: string) => {
    const section = await db.section.findFirstOrThrow({
      where: { weddingId, type: type as never },
      include: { contents: true },
    });
    return { enabled: section.enabled, title: section.title, content: section.contents[0].content };
  };

  async function image(
    weddingId: string,
    status: 'ready' | 'uploading' = 'ready',
  ): Promise<string> {
    const id = uuidV7();
    await db.siteImage.create({
      data: {
        id,
        weddingId,
        status,
        storageKey: `site/${id}/display.jpg`,
        sizeBytes: 3,
        ...(status === 'ready'
          ? {
              thumbKey: `site/${id}/thumb.jpg`,
              ogKey: `site/${id}/og.jpg`,
              width: 2560,
              height: 1707,
              readyAt: new Date(),
              unusedSince: new Date(),
            }
          : {}),
      },
    });
    return id;
  }

  const ceremony = {
    enabled: true,
    title: 'Cerimônia & Recepção',
    content: {
      venues: [
        {
          title: 'Cerimônia',
          placeName: 'Capela Nossa Senhora das Graças',
          date: '2026-11-14',
          time: '16:30',
          address: 'Rua Barão de Jaguara, 1200, Centro, Campinas, SP',
        },
        {
          title: 'Recepção',
          placeName: 'Espaço Villa Toscana',
          date: null,
          time: null,
          address: 'Estrada da Rhodia, 3500, Barão Geraldo, Campinas, SP',
        },
      ],
    },
  };

  it('RN07 e RN13 - grava a Cerimônia & Recepção inteira e devolve a seção como no Editor', async () => {
    const { ana, weddingId } = await anaWedding();

    const response = await put(ana.cookie, weddingId, 'ceremony', ceremony).expect(200);

    expect(response.body).toEqual({
      type: 'ceremony',
      enabled: true,
      empty: false,
      title: 'Cerimônia & Recepção',
      content: ceremony.content,
    });
    expect(await stored(weddingId, 'ceremony')).toEqual(ceremony);
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).siteUpdatedAt,
    ).not.toBeNull();
  });

  it('RN04 - texto simples: trim, \\r\\n vira \\n e sem caracteres de controle', async () => {
    const { ana, weddingId } = await anaWedding();

    await put(ana.cookie, weddingId, 'lodging', {
      enabled: true,
      title: '  Hospedagem\te transporte ',
      content: { text: '  Hotel Monreale\r\n\r\nVan às 18h\u0007\u0000 <b>sem HTML</b>  ' },
    }).expect(200);

    expect(await stored(weddingId, 'lodging')).toEqual({
      enabled: true,
      title: 'Hospedageme transporte',
      content: { text: 'Hotel Monreale\n\nVan às 18h <b>sem HTML</b>' },
    });
  });

  it('RN11 - desligar só esconde: o conteúdo fica guardado', async () => {
    const { ana, weddingId } = await anaWedding();
    await put(ana.cookie, weddingId, 'ceremony', ceremony).expect(200);

    const response = await put(ana.cookie, weddingId, 'ceremony', {
      ...ceremony,
      enabled: false,
    }).expect(200);

    expect(response.body).toMatchObject({ enabled: false, content: ceremony.content });
  });

  it('RN12 - todos os limites no servidor, com o caminho do campo e o prefixo content.', async () => {
    const { ana, weddingId } = await anaWedding();
    const errorsOf = async (type: string, body: object) =>
      (await put(ana.cookie, weddingId, type, body).expect(400)).body.errors as {
        path: string;
        code: string;
        params: Record<string, unknown>;
      }[];

    expect(
      await errorsOf('ceremony', {
        ...ceremony,
        content: {
          venues: [ceremony.content.venues[0], { ...ceremony.content.venues[1], address: ' ' }],
        },
      }),
    ).toEqual([{ path: 'content.venues.1.address', code: 'IS_NOT_EMPTY', params: {} }]);
    expect(
      await errorsOf('faq', {
        enabled: true,
        title: 'Perguntas frequentes',
        content: {
          items: Array.from({ length: 31 }, (_, i) => ({ question: `P${i}`, answer: 'R' })),
        },
      }),
    ).toEqual([{ path: 'content.items', code: 'ARRAY_MAX_SIZE', params: { max: 30 } }]);
    expect(
      await errorsOf('story', {
        enabled: true,
        title: 'Nossa história',
        content: { text: 'a'.repeat(5001), imageIds: [] },
      }),
    ).toEqual([{ path: 'content.text', code: 'MAX_LENGTH', params: { max: 5000 } }]);
    expect(
      await errorsOf('lodging', {
        enabled: true,
        title: '',
        content: { text: '', mapa: 'https://maps' },
      }),
    ).toEqual([
      { path: 'title', code: 'IS_NOT_EMPTY', params: {} },
      { path: 'content.mapa', code: 'WHITELIST_VALIDATION', params: {} },
    ]);
    expect(await errorsOf('countdown', { enabled: true, title: 'Faltam', content: {} })).toEqual([
      { path: 'title', code: 'IS_EMPTY', params: {} },
    ]);
    expect(
      await errorsOf('ceremony', {
        ...ceremony,
        content: { venues: [{ ...ceremony.content.venues[0], time: '25:00' }] },
      }),
    ).toEqual([expect.objectContaining({ path: 'content.venues.0.time', code: 'MATCHES' })]);
    expect(await errorsOf('gifts', { enabled: true, title: 'Presentes', content: {} })).toEqual([
      expect.objectContaining({ path: 'type', code: 'IS_IN' }),
    ]);
  });

  it('RN05, RN12 e Imagens RN08 - fotos prontas do casamento entram em uso; tirar a foto a põe fora de uso', async () => {
    const { ana, weddingId } = await anaWedding();
    const [first, second] = [await image(weddingId), await image(weddingId)];

    const response = await put(ana.cookie, weddingId, 'story', {
      enabled: true,
      title: 'Nossa história',
      content: { text: '', imageIds: [second, first] },
    }).expect(200);

    expect((response.body.content.images as { id: string }[]).map((item) => item.id)).toEqual([
      second,
      first,
    ]);
    expect(response.body.empty).toBe(false);
    const unused = async (id: string) =>
      (await db.siteImage.findUniqueOrThrow({ where: { id } })).unusedSince;
    expect(await unused(first)).toBeNull();
    expect(await unused(second)).toBeNull();

    await put(ana.cookie, weddingId, 'story', {
      enabled: true,
      title: 'Nossa história',
      content: { text: 'Nos conhecemos na faculdade.', imageIds: [second] },
    }).expect(200);
    expect(await unused(first)).not.toBeNull();
    expect(await unused(second)).toBeNull();
  });

  it('RN12 e Imagens RN10 - foto de outro casamento ou ainda não pronta: 404 IMAGE_NOT_FOUND com os ids', async () => {
    const { ana, weddingId } = await anaWedding();
    const other = await anaWedding();
    const foreign = await image(other.weddingId);
    const uploading = await image(weddingId, 'uploading');
    const ok = await image(weddingId);

    const response = await put(ana.cookie, weddingId, 'dress_code', {
      enabled: true,
      title: 'Dress code',
      content: { text: 'Esporte fino', imageId: foreign },
    }).expect(404);
    expect(response.body).toMatchObject({ error: 'IMAGE_NOT_FOUND', imageIds: [foreign] });
    const story = await put(ana.cookie, weddingId, 'story', {
      enabled: true,
      title: 'Nossa história',
      content: { text: '', imageIds: [ok, uploading] },
    }).expect(404);
    expect(story.body.imageIds).toEqual([uploading]);
    expect(await stored(weddingId, 'story')).toMatchObject({
      content: { text: '', imageIds: [] },
    });
  });

  it('RN13 - a cerimonialista também grava; sem vínculo, 404', async () => {
    const { juliana, weddingId } = await anaWedding();
    const estranha = await signedInUser({ app, name: 'Estranha' });
    const faq = {
      enabled: true,
      title: 'Perguntas frequentes',
      content: { items: [{ question: 'E se chover?', answer: 'A cerimônia vai para o salão.' }] },
    };

    await put(juliana.cookie, weddingId, 'faq', faq).expect(200);
    expect((await put(estranha.cookie, weddingId, 'faq', faq).expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
  });
});
