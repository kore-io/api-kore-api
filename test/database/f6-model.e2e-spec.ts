import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';

/**
 * Migration da F6 direto no SQL, com o usuário real da API (kore_api):
 * - o perfil e a assessoria, que só a própria pessoa altera;
 * - os modelos do cerimonialista, isolados por current_planner_id();
 * - as policies do Novo casamento e a restritiva da atribuição;
 * - o token cifrado só no link do casal;
 * - a preferência geral e o wedding_published uma vez por casamento;
 * - o estado do resumo agrupado, que é só do worker.
 * Cada caso numa transação desfeita.
 */
describe('Migration da F6 (banco real, usuário kore_api; decisões 223 e 224)', () => {
  let api: Client;
  let owner: Client;
  let juliana: { userId: string; referrerId: string; plannerId: string; organizationId: string };
  let clara: { userId: string; referrerId: string; plannerId: string; organizationId: string };
  let ana: string; // dona de um casamento, sem perfil de cerimonialista
  let anaWeddingId: string;

  async function user(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now()) RETURNING id`,
      [uuidV7(), `${randomUUID()}@kore.local`],
    );
    return rows[0].id;
  }

  async function planner(status = 'active') {
    const userId = await user();
    const referrerId = uuidV7();
    const plannerId = uuidV7();
    const organizationId = uuidV7();
    await owner.query(
      `INSERT INTO referrers (id, updated_at, user_id, kind, referral_code, rate_percent, status)
       VALUES ($1, now(), $2, 'planner', $3, 20, $4)`,
      [referrerId, userId, `cerimonialista-${randomUUID()}`, status],
    );
    await owner.query(
      `INSERT INTO planners (id, updated_at, referrer_id, credit_name) VALUES ($1, now(), $2, 'Prado Assessoria')`,
      [plannerId, referrerId],
    );
    await owner.query(
      `INSERT INTO organizations (id, name, created_by_user_id) VALUES ($1, 'Prado Assessoria', $2)`,
      [organizationId, userId],
    );
    await owner.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
      [uuidV7(), organizationId, userId],
    );
    return { userId, referrerId, plannerId, organizationId };
  }

  beforeAll(async () => {
    api = new Client({ connectionString: process.env.DATABASE_URL });
    owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await Promise.all([api.connect(), owner.connect()]);
    [juliana, clara] = [await planner(), await planner()];
    ana = await user();
    anaWeddingId = uuidV7();
    await owner.query(
      `INSERT INTO weddings (id, updated_at, slug, status, timezone, city, state,
         created_by_user_id, signup_source)
       VALUES ($1, now(), $2, 'draft', 'America/Sao_Paulo', 'Campinas', 'SP', $3, 'direct')`,
      [anaWeddingId, `f6-${randomUUID()}`, ana],
    );
    await owner.query(
      `INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
      [uuidV7(), anaWeddingId, ana],
    );
  });

  afterAll(async () => {
    await Promise.all([api?.end(), owner?.end()]);
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

  const RLS = /row-level security/;
  const DENIED = /permission denied/;

  describe('Perfil e assessoria (Cadastro e perfil RN09; revisão C1-2)', () => {
    it('a leitura segue livre; a pessoa altera só o próprio perfil e a própria assessoria', async () => {
      await as(clara.userId, async () => {
        expect(
          (await api.query('SELECT 1 FROM planners WHERE id = $1', [juliana.plannerId])).rowCount,
        ).toBe(1);
        const other = await api.query(
          `UPDATE planners SET credit_name = 'Invasora' WHERE id = $1`,
          [juliana.plannerId],
        );
        expect(other.rowCount).toBe(0);
        const own = await api.query(
          `UPDATE planners SET credit_name = 'Dias Eventos', cities = '{"Campinas (SP)"}' WHERE id = $1`,
          [clara.plannerId],
        );
        expect(own.rowCount).toBe(1);

        expect(
          (
            await api.query(`UPDATE organizations SET name = 'Invasora' WHERE id = $1`, [
              juliana.organizationId,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await api.query(`UPDATE organizations SET name = 'Dias Eventos' WHERE id = $1`, [
              clara.organizationId,
            ])
          ).rowCount,
        ).toBe(1);
      });
    });

    it('Assinatura RN06 - as colunas do Admin ficam fora do GRANT', async () => {
      await as(clara.userId, async () => {
        await rejects(
          `UPDATE planners SET credit_hidden_at = now() WHERE id = $1`,
          [clara.plannerId],
          DENIED,
        );
      });
      const { rows } = await owner.query<{ credit_hidden_at: Date | null }>(
        'SELECT credit_hidden_at FROM planners WHERE id = $1',
        [clara.plannerId],
      );
      expect(rows[0].credit_hidden_at).toBeNull();
    });

    it('o perfil novo só para o Referrer da própria pessoa', async () => {
      await as(clara.userId, async () => {
        await rejects(
          `INSERT INTO planners (id, updated_at, referrer_id, credit_name) VALUES ($1, now(), $2, 'X')`,
          [uuidV7(), juliana.referrerId],
          RLS,
        );
        await rejects(
          `INSERT INTO organizations (id, name, created_by_user_id) VALUES ($1, 'X', $2)`,
          [uuidV7(), juliana.userId],
          RLS,
        );
      });
    });
  });

  describe('Modelos do cerimonialista (revisão C6-2 e C6-8)', () => {
    const insertTemplate = ({
      plannerId,
      kind = 'faq',
      sectionType = null,
    }: {
      plannerId: string;
      kind?: string;
      sectionType?: string | null;
    }) =>
      api
        .query(
          `INSERT INTO planner_templates (id, updated_at, planner_id, kind, section_type, name, content)
           VALUES ($1, now(), $2, $3, $4, 'Perguntas', '{"questions":[]}')`,
          [uuidV7(), plannerId, kind, sectionType],
        )
        .then(() => undefined);

    it('cada cerimonialista vê, altera e apaga só os próprios modelos', async () => {
      const templateId = uuidV7();
      await owner.query(
        `INSERT INTO planner_templates (id, updated_at, planner_id, kind, name, content)
         VALUES ($1, now(), $2, 'faq', 'Perguntas da Juliana', '{"questions":[]}')`,
        [templateId, juliana.plannerId],
      );

      await as(clara.userId, async () => {
        expect((await api.query('SELECT id FROM planner_templates')).rowCount).toBe(0);
        expect(
          (await api.query(`UPDATE planner_templates SET name = 'X' WHERE id = $1`, [templateId]))
            .rowCount,
        ).toBe(0);
        expect(
          (await api.query('DELETE FROM planner_templates WHERE id = $1', [templateId])).rowCount,
        ).toBe(0);
        await api.query('SAVEPOINT s');
        await expect(insertTemplate({ plannerId: juliana.plannerId })).rejects.toThrow(RLS);
        await api.query('ROLLBACK TO SAVEPOINT s');
        await insertTemplate({ plannerId: clara.plannerId });
        expect((await api.query('SELECT id FROM planner_templates')).rowCount).toBe(1);
      });

      await as(juliana.userId, async () => {
        const { rows } = await api.query<{ id: string }>('SELECT id FROM planner_templates');
        expect(rows.map((row) => row.id)).toEqual([templateId]);
        await rejects(
          `UPDATE planner_templates SET planner_id = $1 WHERE id = $2`,
          [clara.plannerId, templateId],
          DENIED,
        );
        expect(
          (
            await api.query(`UPDATE planner_templates SET name = 'Perguntas' WHERE id = $1`, [
              templateId,
            ])
          ).rowCount,
        ).toBe(1);
      });
    });

    it('sem o perfil ativo (sem Planner ou com o indicador inativo), nenhum modelo', async () => {
      const inactive = await planner('inactive');
      await owner.query(
        `INSERT INTO planner_templates (id, updated_at, planner_id, kind, name, content)
         VALUES ($1, now(), $2, 'faq', 'Antigo', '{"questions":[]}')`,
        [uuidV7(), inactive.plannerId],
      );

      await as(inactive.userId, async () => {
        expect((await api.query('SELECT id FROM planner_templates')).rowCount).toBe(0);
        await rejects(
          `INSERT INTO planner_templates (id, updated_at, planner_id, kind, name, content)
           VALUES ($1, now(), $2, 'faq', 'Novo', '{}')`,
          [uuidV7(), inactive.plannerId],
          RLS,
        );
      });
      await as(ana, async () => {
        expect((await api.query('SELECT current_planner_id() AS id')).rows[0].id).toBeNull();
      });
    });

    it('C6-8 - o tipo de seção só em section_content, e só story, lodging e dress_code', async () => {
      await as(clara.userId, async () => {
        await insertTemplate({
          plannerId: clara.plannerId,
          kind: 'section_content',
          sectionType: 'story',
        });
        const CHECK = /chk_planner_templates_section_type/;
        await api.query('SAVEPOINT s');
        await expect(
          insertTemplate({
            plannerId: clara.plannerId,
            kind: 'section_content',
            sectionType: null,
          }),
        ).rejects.toThrow(CHECK);
        await api.query('ROLLBACK TO SAVEPOINT s');
        await expect(
          insertTemplate({
            plannerId: clara.plannerId,
            kind: 'section_content',
            sectionType: 'gifts',
          }),
        ).rejects.toThrow(CHECK);
        await api.query('ROLLBACK TO SAVEPOINT s');
        await expect(
          insertTemplate({ plannerId: clara.plannerId, kind: 'faq', sectionType: 'story' }),
        ).rejects.toThrow(CHECK);
        await api.query('ROLLBACK TO SAVEPOINT s');
      });
    });
  });

  describe('Novo casamento pelo cerimonialista (RN04; revisão C3-3)', () => {
    const insertWedding = ({
      createdBy,
      referrerId,
      source,
    }: {
      createdBy: string;
      referrerId: string | null;
      source: string | null;
    }) => {
      const id = uuidV7();
      return api
        .query(
          `INSERT INTO weddings (id, updated_at, slug, status, timezone, city, state,
             created_by_user_id, signup_source, referrer_id, referral_source)
           VALUES ($1, now(), $2, 'draft', 'America/Sao_Paulo', 'Valinhos', 'SP', $3, 'planner', $4, $5)`,
          [id, `f6-${randomUUID()}`, createdBy, referrerId, source],
        )
        .then(() => id);
    };
    const insertMembership = (weddingId: string, userId: string, role: string) =>
      api.query(`INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)`, [
        uuidV7(),
        weddingId,
        userId,
        role,
      ]);
    const insertPartner = (weddingId: string, slot: number, userId: string | null) =>
      api.query(
        `INSERT INTO partners (id, updated_at, wedding_id, slot, display_name, user_id)
         VALUES ($1, now(), $2, $3, 'Fernanda', $4)`,
        [uuidV7(), weddingId, slot, userId],
      );

    it('ela cria o casamento atribuído a ela, o próprio vínculo collaborator e os noivos sem login', async () => {
      await as(juliana.userId, async () => {
        const weddingId = await insertWedding({
          createdBy: juliana.userId,
          referrerId: juliana.referrerId,
          source: 'created_by_planner',
        });
        await insertMembership(weddingId, juliana.userId, 'collaborator');
        await insertPartner(weddingId, 1, null);
        await insertPartner(weddingId, 2, null);
        expect(
          (await api.query('SELECT 1 FROM partners WHERE wedding_id = $1', [weddingId])).rowCount,
        ).toBe(2);
      });
    });

    it('restritiva - a atribuição a outro indicador, ou de uma origem do aceite ou do Admin, é recusada', async () => {
      await as(juliana.userId, async () => {
        for (const source of ['created_by_planner', 'created_by_seller']) {
          await api.query('SAVEPOINT s');
          await expect(
            insertWedding({
              createdBy: juliana.userId,
              referrerId: clara.referrerId,
              source,
            }),
          ).rejects.toThrow(RLS);
          await api.query('ROLLBACK TO SAVEPOINT s');
        }
        for (const source of ['invited_before_payment', 'admin_reassigned']) {
          await api.query('SAVEPOINT s');
          await expect(
            insertWedding({ createdBy: juliana.userId, referrerId: juliana.referrerId, source }),
          ).rejects.toThrow(RLS);
          await api.query('ROLLBACK TO SAVEPOINT s');
        }
      });
      // O cadastro do casal pelo link de indicação segue com o indicador do código.
      await as(ana, async () => {
        await insertWedding({
          createdBy: ana,
          referrerId: juliana.referrerId,
          source: 'referral_link',
        });
      });
    });

    it('o vínculo collaborator não entra em casamento de outra pessoa, nem num casamento que já tem vínculo', async () => {
      await as(juliana.userId, async () => {
        await rejects(
          'INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)',
          [uuidV7(), anaWeddingId, juliana.userId, 'collaborator'],
          RLS,
        );
        const weddingId = await insertWedding({
          createdBy: juliana.userId,
          referrerId: juliana.referrerId,
          source: 'created_by_planner',
        });
        await insertMembership(weddingId, juliana.userId, 'collaborator');
        await rejects(
          'INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)',
          [uuidV7(), weddingId, juliana.userId, 'collaborator'],
          RLS,
        );
        // Nem vínculo de dono: ela não vira dona pelo cadastro (decisão 168(10)).
        await rejects(
          'INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)',
          [uuidV7(), weddingId, juliana.userId, 'owner'],
          RLS,
        );
        // O noivo com login não entra por aqui: só pelo aceite.
        await rejects(
          `INSERT INTO partners (id, updated_at, wedding_id, slot, display_name, user_id)
           VALUES ($1, now(), $2, 1, 'Juliana', $3)`,
          [uuidV7(), weddingId, juliana.userId],
          RLS,
        );
      });
    });

    it('sem o perfil ativo, nada disso vale', async () => {
      const inactive = await planner('inactive');
      await as(inactive.userId, async () => {
        await rejects(
          `INSERT INTO weddings (id, updated_at, slug, status, timezone, city, state,
             created_by_user_id, signup_source, referrer_id, referral_source)
           VALUES ($1, now(), $2, 'draft', 'America/Sao_Paulo', 'Valinhos', 'SP', $3, 'planner', $4, 'created_by_planner')`,
          [uuidV7(), `f6-${randomUUID()}`, inactive.userId, inactive.referrerId],
          RLS,
        );
      });
    });
  });

  it('N1(b) - o token cifrado só no convite do casal sem e-mail', async () => {
    const insert = (kind: string, email: string | null) =>
      owner.query(
        `INSERT INTO access_invitations (id, wedding_id, kind, email, role, token_hash,
           invited_by_user_id, expires_at, token_encrypted)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 days', 'cifrado')`,
        [
          uuidV7(),
          anaWeddingId,
          kind,
          email,
          kind === 'planner' ? 'collaborator' : 'owner',
          randomUUID(),
          ana,
        ],
      );
    const CHECK = /chk_access_invitations_token_encrypted/;

    await insert('couple', null);
    await expect(insert('couple', 'fernanda@kore.local')).rejects.toThrow(CHECK);
    await expect(insert('partner', 'marcos@kore.local')).rejects.toThrow(CHECK);
  });

  it('Assinatura RN05 - o show_planner_credit nasce true e o dono o altera', async () => {
    await as(ana, async () => {
      const { rows } = await api.query<{ show_planner_credit: boolean }>(
        'SELECT show_planner_credit FROM weddings WHERE id = $1',
        [anaWeddingId],
      );
      expect(rows[0].show_planner_credit).toBe(true);
      expect(
        (
          await api.query('UPDATE weddings SET show_planner_credit = false WHERE id = $1', [
            anaWeddingId,
          ])
        ).rowCount,
      ).toBe(1);
    });
  });

  describe('Notificações da cerimonialista (RN03, RN06 e RN07)', () => {
    it('RN06 - a preferência geral é da própria pessoa, uma por tipo', async () => {
      const insertGeneral = (userId: string) =>
        api.query(
          `INSERT INTO notification_preferences (id, updated_at, user_id, wedding_id, type, email)
           VALUES ($1, now(), $2, NULL, 'rsvp', 'immediate')`,
          [uuidV7(), userId],
        );

      await as(juliana.userId, async () => {
        await insertGeneral(juliana.userId);
        expect(
          (await api.query('SELECT 1 FROM notification_preferences WHERE wedding_id IS NULL'))
            .rowCount,
        ).toBe(1);
        expect(
          (
            await api.query(
              `UPDATE notification_preferences SET email = 'off' WHERE wedding_id IS NULL`,
            )
          ).rowCount,
        ).toBe(1);
        await rejects(
          `INSERT INTO notification_preferences (id, updated_at, user_id, wedding_id, type, email)
           VALUES ($1, now(), $2, NULL, 'rsvp', 'daily')`,
          [uuidV7(), juliana.userId],
          /uq_notification_preferences_user_id_type_general/,
        );
        await rejects(
          `INSERT INTO notification_preferences (id, updated_at, user_id, wedding_id, type, email)
           VALUES ($1, now(), $2, NULL, 'rsvp', 'daily')`,
          [uuidV7(), clara.userId],
          RLS,
        );
      });

      await owner.query(
        `INSERT INTO notification_preferences (id, updated_at, user_id, wedding_id, type)
         VALUES ($1, now(), $2, NULL, 'wedding_published')`,
        [uuidV7(), clara.userId],
      );
      await as(juliana.userId, async () => {
        expect(
          (await api.query('SELECT 1 FROM notification_preferences WHERE wedding_id IS NULL'))
            .rowCount,
        ).toBe(0);
      });
    });

    it('RN03 - o wedding_published uma vez por pessoa e casamento (segunda barreira)', async () => {
      // A primeira já lida: o índice das não lidas por groupKey não entra no caso.
      const insert = (readAt: Date | null) =>
        owner.query(
          `INSERT INTO notifications (id, user_id, wedding_id, type, group_key, payload, read_at)
           VALUES ($1, $2, $3, 'wedding_published', $4, $5, $6)`,
          [
            uuidV7(),
            juliana.userId,
            anaWeddingId,
            `wedding_published:${anaWeddingId}`,
            JSON.stringify([{ partnerNames: ['Ana', 'Marcos'] }]),
            readAt,
          ],
        );

      await insert(new Date());
      await expect(insert(null)).rejects.toThrow(
        /uq_notifications_user_id_wedding_id_wedding_published/,
      );
    });

    it('RN07 - o estado do resumo agrupado é só do worker', async () => {
      await as(juliana.userId, async () => {
        await rejects('SELECT * FROM notification_digest_states', [], DENIED);
        await rejects(
          `INSERT INTO notification_digest_states (user_id, updated_at) VALUES ($1, now())`,
          [juliana.userId],
          DENIED,
        );
      });
    });
  });
});
