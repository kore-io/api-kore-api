import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * Migration do site (F2) direto no SQL, com o usuário real da API (kore_api):
 * as 6 seções que nascem com o casamento, a RLS por vínculo, as colunas
 * imutáveis, os CHECKs da aparência e do contato e a FK composta da capa.
 * Cada caso numa transação desfeita.
 */
describe('Migration da F2: site (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string; // dona
  let juliana: string; // cerimonialista (colaboradora)
  let estranha: string; // dona de outro casamento
  let weddingId: string;
  let otherWeddingId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, juliana, estranha] = [await user(), await user(), await user()];
    weddingId = (await seedWedding({ db, ownerId: ana, collaboratorIds: [juliana] })).weddingId;
    otherWeddingId = (await seedWedding({ db, ownerId: estranha })).weddingId;
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function as<T>(userId: string, work: () => Promise<T>): Promise<T> {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  /** Erro esperado sem perder a transação do caso. */
  async function rejects(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await api.query('SAVEPOINT s');
    await expect(api.query(sql, params)).rejects.toThrow(pattern);
    await api.query('ROLLBACK TO SAVEPOINT s');
  }

  const readyImage = async (wedding: string): Promise<string> => {
    const id = uuidV7();
    await db.siteImage.create({
      data: {
        id,
        weddingId: wedding,
        status: 'ready',
        storageKey: `site/${id}/display.jpg`,
        thumbKey: `site/${id}/thumb.jpg`,
        ogKey: `site/${id}/og.jpg`,
        sizeBytes: 3,
        width: 10,
        height: 10,
        readyAt: new Date(),
        unusedSince: new Date(),
      },
    });
    return id;
  };

  it('Seções RN01 e RN02 - o casamento nasce com as 6 seções da F2, na ordem, com os títulos padrão e o corpo vazio', async () => {
    const sections = await db.section.findMany({
      where: { weddingId },
      orderBy: { position: 'asc' },
      include: { contents: true },
    });

    expect(
      sections.map(({ type, position, enabled, title, contents }) => ({
        type,
        position,
        enabled,
        title,
        contents: contents.map(({ locale, content }) => ({ locale, content })),
      })),
    ).toEqual([
      {
        type: 'story',
        position: 1,
        enabled: false,
        title: 'Nossa história',
        contents: [{ locale: 'pt-BR', content: { text: '', imageIds: [] } }],
      },
      {
        type: 'countdown',
        position: 2,
        enabled: true,
        title: null,
        contents: [{ locale: 'pt-BR', content: {} }],
      },
      {
        type: 'ceremony',
        position: 3,
        enabled: true,
        title: 'Cerimônia & Recepção',
        contents: [{ locale: 'pt-BR', content: { venues: [] } }],
      },
      {
        type: 'lodging',
        position: 4,
        enabled: false,
        title: 'Hospedagem e transporte',
        contents: [{ locale: 'pt-BR', content: { text: '' } }],
      },
      {
        type: 'dress_code',
        position: 5,
        enabled: false,
        title: 'Dress code',
        contents: [{ locale: 'pt-BR', content: { text: '', imageId: null } }],
      },
      {
        type: 'faq',
        position: 6,
        enabled: false,
        title: 'Perguntas frequentes',
        contents: [{ locale: 'pt-BR', content: { items: [] } }],
      },
    ]);
  });

  it('Aparência RN02 - nasce Romântico + Terracota + Creme, sem appearanceSetAt; o resto do site nulo', async () => {
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      fontPairKey: 'romantico',
      starterPaletteKey: 'terracota',
      primaryColor: '#A94F37',
      accentColor: '#7A8B69',
      backgroundMode: 'cream',
      appearanceSetAt: null,
      locales: ['pt-BR'],
      contactEmail: null,
      contactWhatsapp: null,
      coverImageId: null,
      siteUpdatedAt: null,
      publishedAt: null,
    });
  });

  it('decisão 153 - dona e cerimonialista leem e mudam as seções; outro casamento, não', async () => {
    for (const userId of [ana, juliana]) {
      await as(userId, async () => {
        const { rowCount } = await api.query(
          `UPDATE sections SET enabled = true, title = 'A nossa história', updated_at = now()
           WHERE wedding_id = $1 AND type = 'story'`,
          [weddingId],
        );
        expect(rowCount).toBe(1);
        const contents = await api.query(
          `UPDATE section_contents SET content = '{"text": "Oi", "imageIds": []}', updated_at = now()
           WHERE wedding_id = $1`,
          [weddingId],
        );
        expect(contents.rowCount).toBe(6);
      });
    }
    await as(estranha, async () => {
      const { rows } = await api.query('SELECT id FROM sections WHERE wedding_id = $1', [
        weddingId,
      ]);
      expect(rows).toEqual([]);
    });
  });

  it('Seções RN11 - a API não apaga seção nem troca tipo, ordem ou casamento', async () => {
    await as(ana, async () => {
      await rejects('DELETE FROM sections WHERE wedding_id = $1', [weddingId], /permission denied/);
      await rejects(
        'DELETE FROM section_contents WHERE wedding_id = $1',
        [weddingId],
        /permission denied/,
      );
      for (const column of ['type', 'position', 'wedding_id'])
        await rejects(
          `UPDATE sections SET ${column} = ${column} WHERE wedding_id = $1`,
          [weddingId],
          /permission denied/,
        );
      await rejects(
        'UPDATE section_contents SET locale = locale WHERE wedding_id = $1',
        [weddingId],
        /permission denied/,
      );
    });
  });

  it('Dados básicos e Aparência - a API grava as colunas do site, dentro dos CHECKs', async () => {
    await as(ana, async () => {
      const { rowCount } = await api.query(
        `UPDATE weddings SET contact_email = 'casal@exemplo.kore.local',
           contact_whatsapp = '+5519998763310', site_updated_at = now(), font_pair_key = 'moderno',
           starter_palette_key = NULL, primary_color = '#1F2A44', accent_color = '#B08D57',
           background_mode = 'light', appearance_set_at = now()
         WHERE id = $1`,
        [weddingId],
      );
      expect(rowCount).toBe(1);
      for (const [column, value] of [
        ['primary_color', '#a94f37'],
        ['accent_color', 'vermelho'],
        ['font_pair_key', 'gotico'],
        ['starter_palette_key', 'neon'],
        ['background_mode', 'transparente'],
        ['contact_whatsapp', '19998763310'],
        ['contact_email', `${'a'.repeat(250)}@x.com`],
      ])
        await rejects(
          `UPDATE weddings SET ${column} = $2 WHERE id = $1`,
          [weddingId, value],
          /chk_weddings_/,
        );
      // Fora da lápide, a aparência não fica nula.
      await rejects(
        'UPDATE weddings SET primary_color = NULL WHERE id = $1',
        [weddingId],
        /chk_weddings_site_tombstone/,
      );
    });
  });

  it('Imagens RN10 - a capa só aceita imagem do mesmo casamento; apagar a imagem tira a capa', async () => {
    const own = await readyImage(weddingId);
    const foreign = await readyImage(otherWeddingId);

    await as(ana, async () => {
      await rejects(
        'UPDATE weddings SET cover_image_id = $2 WHERE id = $1',
        [weddingId, foreign],
        /weddings_cover_image_fkey/,
      );
      const { rowCount } = await api.query(
        'UPDATE weddings SET cover_image_id = $2 WHERE id = $1',
        [weddingId, own],
      );
      expect(rowCount).toBe(1);
    });

    const otherCover = await readyImage(otherWeddingId);
    await db.wedding.update({ where: { id: otherWeddingId }, data: { coverImageId: otherCover } });
    await db.siteImage.delete({ where: { id: otherCover } });
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: otherWeddingId } })).coverImageId,
    ).toBeNull();
  });
});
