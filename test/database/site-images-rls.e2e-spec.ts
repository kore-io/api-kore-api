import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * Migration das imagens do site (S4) direto no SQL, com o usuário real da API
 * (kore_api): RLS por vínculo (decisão 153), colunas imutáveis, sem DELETE e os
 * CHECKs. Cada caso numa transação desfeita.
 */
describe('Migration da F2: site_images (banco real, usuário kore_api)', () => {
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

  const insertImage = async ({
    wedding = weddingId,
    sizeBytes = 1024,
  }: { wedding?: string; sizeBytes?: number } = {}): Promise<string> => {
    const id = uuidV7();
    await api.query(
      `INSERT INTO site_images (id, wedding_id, storage_key, size_bytes, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [id, wedding, `site/${id}/display.jpg`, sizeBytes],
    );
    return id;
  };

  it('RN10 - dona e cerimonialista gravam e leem as imagens do casamento; nasce em "uploading"', async () => {
    for (const userId of [ana, juliana]) {
      await as(userId, async () => {
        const id = await insertImage();
        const { rows } = await api.query('SELECT status FROM site_images WHERE id = $1', [id]);
        expect(rows).toEqual([{ status: 'uploading' }]);
      });
    }
  });

  it('decisão 153 - não grava nem lê imagem de outro casamento', async () => {
    const otherImage = uuidV7();
    await db.siteImage.create({
      data: {
        id: otherImage,
        weddingId: otherWeddingId,
        storageKey: `site/${otherImage}/display.jpg`,
        sizeBytes: 1024,
      },
    });

    await as(ana, async () => {
      await expect(insertImage({ wedding: otherWeddingId })).rejects.toThrow(/row-level security/);
    });
    await as(ana, async () => {
      const { rows } = await api.query('SELECT id FROM site_images WHERE id = $1', [otherImage]);
      expect(rows).toEqual([]);
    });
  });

  it('decisão 207(2) - a API não apaga imagem nem troca a chave, o casamento ou quem enviou', async () => {
    await as(ana, async () => {
      const id = await insertImage();
      await api.query('SAVEPOINT s');
      await expect(api.query('DELETE FROM site_images WHERE id = $1', [id])).rejects.toThrow(
        /permission denied/,
      );
      await api.query('ROLLBACK TO SAVEPOINT s');
      for (const column of ['storage_key', 'wedding_id', 'uploaded_by_user_id']) {
        await expect(
          api.query(`UPDATE site_images SET ${column} = ${column} WHERE id = $1`, [id]),
        ).rejects.toThrow(/permission denied/);
        await api.query('ROLLBACK TO SAVEPOINT s');
      }
      const { rowCount } = await api.query(
        `UPDATE site_images SET status = 'processing', updated_at = now() WHERE id = $1`,
        [id],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('RN05 - até 4 MB; "ready" exige as versões, as medidas e a data', async () => {
    await as(ana, async () => {
      await api.query('SAVEPOINT s');
      await expect(insertImage({ sizeBytes: 4 * 1024 * 1024 + 1 })).rejects.toThrow(
        /chk_site_images_size_bytes/,
      );
      await api.query('ROLLBACK TO SAVEPOINT s');
      const id = await insertImage();
      await expect(
        api.query(`UPDATE site_images SET status = 'ready' WHERE id = $1`, [id]),
      ).rejects.toThrow(/chk_site_images_ready/);
    });
  });
});
