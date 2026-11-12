import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

/**
 * Indicação no banco (Modelo de Dados; decisão 113), com o usuário real da API
 * (kore_api). Cada caso roda numa transação desfeita.
 */
describe('Tabelas da indicação (banco real, usuário kore_api)', () => {
  let api: Client;
  let owner: Client;

  beforeAll(async () => {
    api = new Client({ connectionString: process.env.DATABASE_URL });
    owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await Promise.all([api.connect(), owner.connect()]);
  });

  afterAll(async () => {
    await Promise.all([api?.end(), owner?.end()]);
  });

  async function rolledBack<T>(client: Client, work: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      return await work();
    } finally {
      await client.query('ROLLBACK');
    }
  }

  const insertUser = async (client: Client) =>
    (
      await client.query<{ id: string }>(
        `INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now()) RETURNING id`,
        [randomUUID(), `${randomUUID()}@kore.local`],
      )
    ).rows[0].id;

  it('RN09 - as configurações da indicação nascem com os padrões (20%, 10%, 30 dias, R$ 50) numa linha só', async () => {
    const { rows } = await api.query(
      `SELECT default_rate_percent, referral_discount_percent, commission_hold_days, payout_min_cents
         FROM referral_settings`,
    );

    expect(rows).toEqual([
      {
        default_rate_percent: 20,
        referral_discount_percent: 10,
        commission_hold_days: 30,
        payout_min_cents: 5000,
      },
    ]);
    await rolledBack(owner, async () => {
      await expect(
        owner.query(
          `INSERT INTO referral_settings (id, updated_at, default_rate_percent,
             referral_discount_percent, commission_hold_days, payout_min_cents)
           VALUES ($1, now(), 20, 10, 30, 5000)`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/uq_referral_settings_single_row/);
    });
  });

  it('a API só lê as configurações da indicação: alterar é do Admin, pelo backoffice', async () => {
    await rolledBack(api, async () => {
      await expect(
        api.query('UPDATE referral_settings SET referral_discount_percent = 50'),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('a API cria indicadores, mas não altera nem apaga', async () => {
    await rolledBack(api, async () => {
      const userId = await insertUser(api);
      await api.query(
        `INSERT INTO referrers (id, updated_at, user_id, kind, referral_code, rate_percent)
         VALUES ($1, now(), $2, 'planner', $3, 20)`,
        [randomUUID(), userId, `codigo-${randomUUID()}`],
      );
      await api.query('SAVEPOINT s');
      await expect(api.query(`UPDATE referrers SET status = 'active'`)).rejects.toThrow(
        /permission denied/,
      );
      await api.query('ROLLBACK TO SAVEPOINT s');
      await expect(api.query('DELETE FROM referrers')).rejects.toThrow(/permission denied/);
    });
  });

  it('o código de indicação é único sem diferenciar maiúsculas', async () => {
    await rolledBack(owner, async () => {
      const code = `juliana-${randomUUID()}`;
      const insert = (userId: string, referralCode: string) =>
        owner.query(
          `INSERT INTO referrers (id, updated_at, user_id, kind, referral_code, rate_percent)
           VALUES ($1, now(), $2, 'planner', $3, 20)`,
          [randomUUID(), userId, referralCode],
        );
      await insert(await insertUser(owner), code);
      await expect(insert(await insertUser(owner), code.toUpperCase())).rejects.toThrow(
        /uq_referrers_referral_code/,
      );
    });
  });

  it('só o vendedor tem createdByAdminUserId', async () => {
    await rolledBack(owner, async () => {
      const userId = await insertUser(owner);
      await expect(
        owner.query(
          `INSERT INTO referrers (id, updated_at, user_id, kind, referral_code, rate_percent,
             created_by_admin_user_id)
           VALUES ($1, now(), $2, 'planner', $3, 20, $2)`,
          [randomUUID(), userId, `codigo-${randomUUID()}`],
        ),
      ).rejects.toThrow(/chk_referrers_created_by_admin_seller_only/);
    });
  });

  it('decisão 113 - assessoria mínima: event_staff existe no modelo, e a pessoa tem um vínculo ativo por assessoria', async () => {
    await rolledBack(api, async () => {
      const userId = await insertUser(api);
      // A assessoria tem RLS desde a F6: a pessoa cria a própria (revisão C1-2).
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const organizationId = randomUUID();
      await api.query(
        `INSERT INTO organizations (id, name, created_by_user_id) VALUES ($1, 'Juliana Prado', $2)`,
        [organizationId, userId],
      );
      const member = (role: string) =>
        api.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), organizationId, userId, role],
        );
      await member('event_staff');
      await expect(member('owner')).rejects.toThrow(
        /uq_organization_members_organization_id_user_id_active/,
      );
    });
  });
});
