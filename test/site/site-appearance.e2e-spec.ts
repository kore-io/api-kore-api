import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Aparência do site (S2 RN01 a RN07 e RN10; banco real). */
describe('Aparência do site (banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const put = (cookie: string, weddingId: string, body: object) =>
    request(app.getHttpServer())
      .put(`/v1/weddings/${weddingId}/site/appearance`)
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

  const appearance = (weddingId: string) =>
    db.wedding.findUniqueOrThrow({
      where: { id: weddingId },
      select: {
        fontPairKey: true,
        starterPaletteKey: true,
        primaryColor: true,
        accentColor: true,
        backgroundMode: true,
        appearanceSetAt: true,
        siteUpdatedAt: true,
      },
    });

  it('RN10 - no Checklist, a aparência fica por fazer com o appearanceSetAt nulo, e feita depois do PUT', async () => {
    const { ana, weddingId } = await anaWedding();
    const checklist = async () =>
      (
        (
          await request(app.getHttpServer())
            .get(`/v1/weddings/${weddingId}/dashboard`)
            .set('Cookie', ana.cookie)
            .expect(200)
        ).body.checklist as { key: string; done: boolean }[]
      ).find((item) => item.key === 'appearance');
    expect((await appearance(weddingId)).appearanceSetAt).toBeNull();

    expect(await checklist()).toMatchObject({ done: false });
    await put(ana.cookie, weddingId, {
      fontPairKey: 'moderno',
      starterPaletteKey: 'marinho',
      primaryColor: '#1F2A44',
      accentColor: '#B08D57',
      backgroundMode: 'light',
    }).expect(200);
    expect(await checklist()).toMatchObject({ done: true });
  });

  it('RN08 - o PUT da Aparência deixa as seções e a capa como estavam', async () => {
    const { ana, weddingId } = await anaWedding();
    const untouched = async () => ({
      sections: await db.section.findMany({ where: { weddingId }, orderBy: { id: 'asc' } }),
      contents: await db.sectionContent.findMany({ where: { weddingId }, orderBy: { id: 'asc' } }),
      cover: (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).coverImageId,
    });
    const before = await untouched();

    await put(ana.cookie, weddingId, {
      fontPairKey: 'moderno',
      starterPaletteKey: 'marinho',
      primaryColor: '#1F2A44',
      accentColor: '#B08D57',
      backgroundMode: 'light',
    }).expect(200);

    expect(await untouched()).toEqual(before);
  });

  it('RN06 e RN10 - grava a Aparência com as cores em maiúsculas; o appearanceSetAt fica a primeira data', async () => {
    const { ana, weddingId } = await anaWedding();

    const response = await put(ana.cookie, weddingId, {
      fontPairKey: 'moderno',
      starterPaletteKey: 'marinho',
      primaryColor: '#1f2a44',
      accentColor: '#b08d57',
      backgroundMode: 'light',
    }).expect(200);

    expect(response.body).toEqual({
      fontPairKey: 'moderno',
      starterPaletteKey: 'marinho',
      primaryColor: '#1F2A44',
      primaryForeground: '#FFFFFF',
      accentColor: '#B08D57',
      backgroundMode: 'light',
      warnings: [],
    });
    const first = await appearance(weddingId);
    expect(first).toMatchObject({ primaryColor: '#1F2A44', backgroundMode: 'light' });
    expect(first.appearanceSetAt).not.toBeNull();
    expect(first.siteUpdatedAt).not.toBeNull();

    await put(ana.cookie, weddingId, {
      fontPairKey: 'romantico',
      starterPaletteKey: 'terracota',
      primaryColor: '#A94F37',
      accentColor: '#7A8B69',
      backgroundMode: 'cream',
    }).expect(200);
    expect((await appearance(weddingId)).appearanceSetAt).toEqual(first.appearanceSetAt);
  });

  it('RN07 - a paleta de partida com outra cor vira "cor própria" (null), sem erro', async () => {
    const { ana, weddingId } = await anaWedding();

    const response = await put(ana.cookie, weddingId, {
      fontPairKey: 'romantico',
      starterPaletteKey: 'terracota',
      primaryColor: '#8E3F2C',
      accentColor: '#7A8B69',
      backgroundMode: 'cream',
    }).expect(200);

    expect(response.body.starterPaletteKey).toBeNull();
    expect((await appearance(weddingId)).starterPaletteKey).toBeNull();
  });

  it('RN04 - o destaque pouco visível só avisa: Sálvia no Claro (2,29:1)', async () => {
    const { ana, weddingId } = await anaWedding();

    const response = await put(ana.cookie, weddingId, {
      fontPairKey: 'leve',
      starterPaletteKey: 'salvia',
      primaryColor: '#566C4B',
      accentColor: '#C9A66B',
      backgroundMode: 'light',
    }).expect(200);

    expect(response.body.warnings).toEqual([{ code: 'ACCENT_LOW_CONTRAST', ratio: 2.29 }]);
  });

  it('RN04 e RN05 - cor bloqueada é 422 com o check e a razão, e nada é gravado', async () => {
    const { ana, weddingId } = await anaWedding();
    const before = await appearance(weddingId);

    const text = await put(ana.cookie, weddingId, {
      fontPairKey: 'romantico',
      starterPaletteKey: null,
      primaryColor: '#777777',
      accentColor: '#7A8B69',
      backgroundMode: 'light',
    }).expect(422);
    // Trocar o fundo também confere a primária: a Noite no Claro some.
    const background = await put(ana.cookie, weddingId, {
      fontPairKey: 'romantico',
      starterPaletteKey: 'noite',
      primaryColor: '#E7D3B0',
      accentColor: '#9A8C7A',
      backgroundMode: 'light',
    }).expect(422);

    expect(text.body).toEqual({
      statusCode: 422,
      error: 'CONTRAST_TOO_LOW',
      message: expect.any(String),
      check: 'primary_foreground',
      ratio: 4.47,
    });
    expect(background.body).toMatchObject({ check: 'primary_background', ratio: 1.46 });
    expect(await appearance(weddingId)).toEqual(before);
  });

  it('RN01 e RN06 - os 5 campos são obrigatórios, do catálogo e com cor #RRGGBB', async () => {
    const { ana, weddingId } = await anaWedding();
    const valid = {
      fontPairKey: 'romantico',
      starterPaletteKey: 'terracota',
      primaryColor: '#A94F37',
      accentColor: '#7A8B69',
      backgroundMode: 'cream',
    };

    for (const [field, value] of [
      ['fontPairKey', 'gotico'],
      ['starterPaletteKey', 'neon'],
      ['primaryColor', '#A94F3'],
      ['accentColor', 'verde'],
      ['backgroundMode', 'transparente'],
      ['fontPairKey', undefined],
    ] as const) {
      const response = await put(ana.cookie, weddingId, { ...valid, [field]: value }).expect(400);
      expect(response.body.errors).toEqual([expect.objectContaining({ path: field })]);
    }
  });

  it('RN11 - a cerimonialista também grava (manage_site); sem vínculo, 404', async () => {
    const { juliana, weddingId } = await anaWedding();
    const estranha = await signedInUser({ app, name: 'Estranha' });
    const body = {
      fontPairKey: 'classico',
      starterPaletteKey: 'rose',
      primaryColor: '#A3545E',
      accentColor: '#8C9A7E',
      backgroundMode: 'cream',
    };

    await put(juliana.cookie, weddingId, body).expect(200);
    expect((await put(estranha.cookie, weddingId, body).expect(404)).body.error).toBe(
      'WEDDING_NOT_FOUND',
    );
  });
});
