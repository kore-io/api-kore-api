import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';

/**
 * Policies de inclusão do cadastro (decisão 153, item 4), direto no SQL com o
 * usuário real da API (kore_api). Cada caso roda numa transação desfeita.
 */
describe('RLS do cadastro do casamento (banco real, usuário kore_api)', () => {
  let api: Client;
  let owner: Client;
  let ana: string;
  let bia: string;

  beforeAll(async () => {
    api = new Client({ connectionString: process.env.DATABASE_URL });
    owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await Promise.all([api.connect(), owner.connect()]);
    const user = async () =>
      (
        await owner.query<{ id: string }>(
          `INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now()) RETURNING id`,
          [uuidV7(), `${randomUUID()}@kore.local`],
        )
      ).rows[0].id;
    [ana, bia] = [await user(), await user()];
  });

  afterAll(async () => {
    await Promise.all([api?.end(), owner?.end()]);
  });

  /** Roda como a pessoa indicada, numa transação desfeita. */
  async function as<T>(userId: string | null, work: () => Promise<T>): Promise<T> {
    await api.query('BEGIN');
    try {
      if (userId) await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  const insertWedding = ({
    id = uuidV7(),
    createdBy,
    status = 'draft',
  }: {
    id?: string;
    createdBy: string;
    status?: string;
  }) =>
    api
      .query(
        `INSERT INTO weddings (id, updated_at, slug, status, timezone, city, state,
           created_by_user_id, signup_source)
         VALUES ($1, now(), $2, $3, 'America/Sao_Paulo', 'Campinas', 'SP', $4, 'direct')`,
        [id, `rls-${randomUUID()}`, status, createdBy],
      )
      .then(() => id);
  const insertMembership = (weddingId: string, userId: string, role = 'owner') =>
    api.query(`INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)`, [
      uuidV7(),
      weddingId,
      userId,
      role,
    ]);
  const insertPartner = (weddingId: string, slot: number, userId: string | null) =>
    api.query(
      `INSERT INTO partners (id, updated_at, wedding_id, slot, display_name, user_id)
       VALUES ($1, now(), $2, $3, 'Ana', $4)`,
      [uuidV7(), weddingId, slot, userId],
    );

  it('RN07 - a pessoa cria o próprio casamento, o vínculo de dono e os noivos, sem ver nada antes do vínculo', async () => {
    await as(ana, async () => {
      const weddingId = await insertWedding({ createdBy: ana });
      expect((await api.query('SELECT 1 FROM weddings WHERE id = $1', [weddingId])).rowCount).toBe(
        0,
      );
      await insertMembership(weddingId, ana);
      await insertPartner(weddingId, 1, ana);
      await insertPartner(weddingId, 2, null);
      expect(
        (await api.query('SELECT 1 FROM partners WHERE wedding_id = $1', [weddingId])).rowCount,
      ).toBe(2);
    });
  });

  it('não cria casamento em nome de outra pessoa, nem fora do rascunho, nem sem pessoa na transação', async () => {
    await as(ana, async () => {
      await expect(insertWedding({ createdBy: bia })).rejects.toThrow(/row-level security/);
    });
    await as(ana, async () => {
      await expect(insertWedding({ createdBy: ana, status: 'published' })).rejects.toThrow(
        /row-level security/,
      );
    });
    await as(null, async () => {
      await expect(insertWedding({ createdBy: ana })).rejects.toThrow(/row-level security/);
    });
  });

  it('não se torna dona do casamento criado por outra pessoa, mesmo ainda sem vínculo', async () => {
    await as(ana, async () => {
      const id = await insertWedding({ createdBy: ana });
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [bia]);
      await expect(insertMembership(id, bia)).rejects.toThrow(/row-level security/);
    });
  });

  it('o vínculo do cadastro é só de dono e só da própria pessoa', async () => {
    await as(ana, async () => {
      const id = await insertWedding({ createdBy: ana });
      await api.query('SAVEPOINT s');
      await expect(insertMembership(id, ana, 'collaborator')).rejects.toThrow(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT s');
      await expect(insertMembership(id, bia)).rejects.toThrow(/row-level security/);
    });
  });

  it('noivos só no casamento de que a pessoa é dona, e o login de um noivo só pode ser o dela', async () => {
    await as(ana, async () => {
      const id = await insertWedding({ createdBy: ana });
      await api.query('SAVEPOINT s');
      await expect(insertPartner(id, 1, ana)).rejects.toThrow(/row-level security/);
      await api.query('ROLLBACK TO SAVEPOINT s');
      await insertMembership(id, ana);
      await expect(insertPartner(id, 2, bia)).rejects.toThrow(/row-level security/);
    });
  });

  it('RN05 - wedding_slug_taken enxerga todos os casamentos, mesmo sem pessoa na transação', async () => {
    const slug = `rls-${randomUUID()}`;
    await owner.query('BEGIN');
    try {
      await owner.query(
        `INSERT INTO weddings (id, updated_at, slug, status, timezone, city, state,
           created_by_user_id, signup_source)
         VALUES ($1, now(), $2, 'draft', 'America/Sao_Paulo', 'Campinas', 'SP', $3, 'direct')`,
        [uuidV7(), slug, bia],
      );
      await owner.query('COMMIT');
    } catch (error) {
      await owner.query('ROLLBACK');
      throw error;
    }
    const taken = async (candidate: string) =>
      (await api.query<{ taken: boolean }>('SELECT wedding_slug_taken($1) AS taken', [candidate]))
        .rows[0].taken;

    await as(ana, async () => {
      expect((await api.query('SELECT 1 FROM weddings WHERE slug = $1', [slug])).rowCount).toBe(0);
      expect(await taken(slug.toUpperCase())).toBe(true);
      expect(await taken(`${slug}-livre`)).toBe(false);
    });
  });
});
