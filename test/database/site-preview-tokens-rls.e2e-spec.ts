import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * Migration da prévia (S6) direto no SQL, com o usuário real da API: a pessoa
 * grava só o token dela, a API só marca o uso, e a leitura pelo hash é da
 * função. Cada caso numa transação desfeita.
 */
describe('Migration da F2: site_preview_tokens (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string;
  let juliana: string;
  let weddingId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, juliana] = [await user(), await user()];
    weddingId = (await seedWedding({ db, ownerId: ana, collaboratorIds: [juliana] })).weddingId;
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

  const insert = (userId: string, hash = randomBytes(32).toString('hex')) =>
    api.query(
      `INSERT INTO site_preview_tokens (id, wedding_id, user_id, token_hash, mode, expires_at)
       VALUES ($1, $2, $3, $4, 'visitor', now() + interval '5 minutes')`,
      [uuidV7(), weddingId, userId, hash],
    );

  it('RN02 - a pessoa grava o token dela, não o de outra; o grupo só no modo party', async () => {
    await as(ana, async () => {
      await insert(ana);
      await api.query('SAVEPOINT s');
      await expect(insert(juliana)).rejects.toThrow(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT s');
      await expect(
        api.query(
          `INSERT INTO site_preview_tokens (id, wedding_id, user_id, token_hash, mode, expires_at)
           VALUES ($1, $2, $3, $4, 'party', now())`,
          [uuidV7(), weddingId, ana, randomBytes(32).toString('hex')],
        ),
      ).rejects.toThrow(/chk_site_preview_tokens_party/);
    });
  });

  it('RN03 - a API só marca o uso: sem DELETE e sem trocar o hash, o modo ou a pessoa', async () => {
    await as(ana, async () => {
      await insert(ana);
      for (const sql of [
        'DELETE FROM site_preview_tokens',
        'UPDATE site_preview_tokens SET token_hash = token_hash',
        'UPDATE site_preview_tokens SET mode = mode',
        'UPDATE site_preview_tokens SET user_id = user_id',
      ]) {
        await api.query('SAVEPOINT s');
        await expect(api.query(sql)).rejects.toThrow(/permission denied/);
        await api.query('ROLLBACK TO SAVEPOINT s');
      }
      const { rowCount } = await api.query('UPDATE site_preview_tokens SET used_at = now()');
      expect(rowCount).toBe(1);
    });
  });

  it('RN03 - a leitura pelo hash é da função, sem sessão; a tabela, sem a função, não aparece', async () => {
    const hash = randomBytes(32).toString('hex');
    await db.sitePreviewToken.create({
      data: { weddingId, userId: ana, tokenHash: hash, mode: 'visitor', expiresAt: new Date() },
    });

    const { rows } = await api.query('SELECT site_preview_by_hash($1) AS token', [hash]);
    const direct = await api.query('SELECT id FROM site_preview_tokens WHERE token_hash = $1', [
      hash,
    ]);

    expect(rows[0].token).toMatchObject({ weddingId, userId: ana, mode: 'visitor' });
    expect(direct.rows).toEqual([]);
  });
});
