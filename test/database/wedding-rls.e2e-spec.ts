import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * A RLS por vínculo direto no banco, com o usuário real da API (kore_api), numa
 * conexão só (decisão 153). Cada caso roda numa transação desfeita.
 */
describe('RLS por vínculo nas tabelas do casamento (banco real, usuário kore_api; decisão 153)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let client: Client;
  let ana: string; // dona do casamento A
  let juliana: string; // colaboradora do casamento A
  let bia: string; // dona do casamento B
  let weddingA: string;
  let weddingB: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async (name: string) =>
      (await db.user.create({ data: { email: `${name}.${randomUUID()}@kore.local`, name } })).id;
    [ana, juliana, bia] = [await user('ana'), await user('juliana'), await user('bia')];
    weddingA = (await seedWedding({ db, ownerId: ana, collaboratorIds: [juliana] })).weddingId;
    weddingB = (await seedWedding({ db, ownerId: bia })).weddingId;
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client?.end();
    await app?.close();
  });

  /** Roda como a pessoa (e no casamento) indicados, numa transação desfeita. */
  async function as<T>(
    { userId, weddingId }: { userId?: string; weddingId?: string },
    work: () => Promise<T>,
  ): Promise<T> {
    await client.query('BEGIN');
    try {
      if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      if (weddingId)
        await client.query(`SELECT set_config('app.wedding_id', $1, true)`, [weddingId]);
      return await work();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  const visibleWeddings = async () =>
    (
      await client.query<{ id: string }>(
        'SELECT id FROM weddings WHERE id = ANY($1::uuid[]) ORDER BY id',
        [[weddingA, weddingB]],
      )
    ).rows.map((row) => row.id);

  const membershipOf = async ({ userId, weddingId }: { userId: string; weddingId: string }) =>
    (await db.membership.findFirstOrThrow({ where: { userId, weddingId } })).id;

  describe('leitura (RN01 de Papéis)', () => {
    it('falha fechada: sem app.user_id, nenhuma linha aparece', async () => {
      expect(await as({}, visibleWeddings)).toEqual([]);
    });

    it('com a pessoa de outro casamento e o casamento A definido, nada aparece', async () => {
      expect(await as({ userId: bia, weddingId: weddingA }, visibleWeddings)).toEqual([]);
    });

    it('sem casamento definido (painel), só os casamentos com vínculo aparecem', async () => {
      expect(await as({ userId: ana }, visibleWeddings)).toEqual([weddingA]);
      expect(await as({ userId: juliana }, visibleWeddings)).toEqual([weddingA]);
    });

    it('o SET LOCAL não vaza: depois da transação, a mesma conexão volta a não ver nada', async () => {
      expect(await as({ userId: ana }, visibleWeddings)).toEqual([weddingA]);

      expect(await visibleWeddings()).toEqual([]);
    });
  });

  describe('escrita: ninguém sai do próprio casamento nem muda de papel', () => {
    const update = (sql: string, params: unknown[]) => client.query(sql, params);

    it('dada a colaboradora, quando move o próprio vínculo para outro casamento, então o banco recusa', async () => {
      const own = await membershipOf({ userId: juliana, weddingId: weddingA });

      await as({ userId: juliana }, () =>
        expect(
          update('UPDATE memberships SET wedding_id = $1 WHERE id = $2', [weddingB, own]),
        ).rejects.toThrow(/permission denied/),
      );
    });

    it('dada a colaboradora, quando se promove a dona, então o banco recusa', async () => {
      const own = await membershipOf({ userId: juliana, weddingId: weddingA });

      await as({ userId: juliana }, () =>
        expect(
          update(`UPDATE memberships SET role = 'owner' WHERE id = $1`, [own]),
        ).rejects.toThrow(/permission denied/),
      );
    });

    it('dada a colaboradora, quando tenta remover a dona (o vínculo de outra pessoa), então nada muda', async () => {
      const owner = await membershipOf({ userId: ana, weddingId: weddingA });

      const { rowCount } = await as({ userId: juliana }, () =>
        update('UPDATE memberships SET removed_at = now() WHERE id = $1', [owner]),
      );

      expect(rowCount).toBe(0);
    });

    it('dada a dona, quando remove a colaboradora (RN06), então pode', async () => {
      const collaborator = await membershipOf({ userId: juliana, weddingId: weddingA });

      const { rowCount } = await as({ userId: ana }, () =>
        update('UPDATE memberships SET removed_at = now(), removed_by_user_id = $2 WHERE id = $1', [
          collaborator,
          ana,
        ]),
      );

      expect(rowCount).toBe(1);
    });

    it('dada a colaboradora, quando sai por conta própria (RN06), então pode', async () => {
      const own = await membershipOf({ userId: juliana, weddingId: weddingA });

      const { rowCount } = await as({ userId: juliana }, () =>
        update('UPDATE memberships SET removed_at = now() WHERE id = $1', [own]),
      );

      expect(rowCount).toBe(1);
    });

    it('dada a dona de outro casamento, quando tenta remover alguém do casamento A, então nada muda', async () => {
      const collaborator = await membershipOf({ userId: juliana, weddingId: weddingA });

      const { rowCount } = await as({ userId: bia }, () =>
        update('UPDATE memberships SET removed_at = now() WHERE id = $1', [collaborator]),
      );

      expect(rowCount).toBe(0);
    });

    it.each([
      [
        'mover um noivo para outro casamento',
        'UPDATE partners SET wedding_id = $2::uuid WHERE wedding_id = $1::uuid',
        'weddingB',
      ],
      [
        'ligar um login a um noivo',
        'UPDATE partners SET user_id = $2::uuid WHERE wedding_id = $1::uuid',
        'bia',
      ],
      [
        'trocar quem criou o casamento',
        'UPDATE weddings SET created_by_user_id = $2::uuid WHERE id = $1::uuid',
        'bia',
      ],
    ] as const)(
      'dada a dona, quando tenta %s, então o banco recusa (coluna imutável pela API)',
      async (_, sql, value) => {
        const params = [weddingA, value === 'weddingB' ? weddingB : bia];

        await as({ userId: ana }, () =>
          expect(update(sql, params)).rejects.toThrow(/permission denied/),
        );
      },
    );

    it('a API não cria casamento em nome de outra pessoa (policy do cadastro)', async () => {
      await as({ userId: ana }, () =>
        expect(
          update(
            `INSERT INTO weddings (id, slug, status, timezone, city, state, created_by_user_id,
               signup_source, updated_at)
             VALUES ($1, $2, 'draft', 'America/Sao_Paulo', 'Campinas', 'SP', $3, 'direct', now())`,
            [randomUUID(), `invasor-${randomUUID()}`, bia],
          ),
        ).rejects.toThrow(/row-level security/),
      );
    });
  });

  describe('estrutura (decisão 153)', () => {
    it('as tabelas do casamento têm FORCE ROW LEVEL SECURITY e não pertencem à API', async () => {
      const { rows } = await client.query<{ relname: string; forced: boolean; owner: string }>(
        `SELECT relname, relforcerowsecurity AS forced, pg_get_userbyid(relowner) AS owner
         FROM pg_class WHERE relname IN ('weddings', 'partners', 'memberships') ORDER BY relname`,
      );

      expect(rows.map(({ relname, forced }) => [relname, forced])).toEqual([
        ['memberships', true],
        ['partners', true],
        ['weddings', true],
      ]);
      expect(rows.every(({ owner }) => owner !== 'kore_api')).toBe(true);
    });

    it.each(['active_wedding_ids', 'owned_wedding_ids'])(
      'a função %s é SECURITY DEFINER e STABLE, com search_path fixo, dona sem login e fora do PUBLIC',
      async (name) => {
        const { rows } = await client.query<{
          definer: boolean;
          config: string[];
          owner: string;
          volatile: string;
          public_can_execute: boolean;
          owner_can_login: boolean;
        }>(
          `SELECT p.prosecdef AS definer, p.proconfig AS config, pg_get_userbyid(p.proowner) AS owner,
                  p.provolatile AS volatile,
                  has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute,
                  r.rolcanlogin AS owner_can_login
           FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner WHERE p.proname = $1`,
          [name],
        );

        expect(rows[0]).toEqual({
          definer: true,
          config: ['search_path=public, pg_temp'],
          owner: 'kore_rls',
          volatile: 's',
          public_can_execute: false,
          owner_can_login: false,
        });
      },
    );
  });
});
