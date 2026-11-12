import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';

/**
 * Migration da F3 direto no SQL, com o usuário real da API (kore_api):
 * - Payment: o dono lê e cria o pendente; estado e valores ficam fora do kore_app;
 *   os CHECK de dinheiro e os índices únicos de appliedAt (Publicar e pagar RN07,
 *   RN10, RN12 e RN20; decisão 231, B2-2);
 * - o "Aguardando pagamento" só em booleano (RN06);
 * - as tabelas só do worker (GatewayEvent, GatewayCustomer, Alert, SupportSession,
 *   CourtesyExtension, BillingNoticeLog);
 * - comissão, ajuste, repasse e chave Pix por referrerId (Comissões RN10; Repasse);
 * - as policies da central por tipo novo (G6);
 * - lápide, fuso e datas do casamento.
 * Cada caso numa transação desfeita.
 */
describe('Migration da F3 (banco real, usuário kore_api; decisões 230 e 231)', () => {
  let api: Client;
  let owner: Client;
  let ana: string; // dona
  let marcos: string; // outro dono
  let juliana: { userId: string; referrerId: string }; // colaboradora e indicadora
  let clara: { userId: string; referrerId: string }; // outra indicadora, sem vínculo
  let stranger: string;
  let weddingId: string;
  let otherWeddingId: string;

  async function user(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO users (id, email, updated_at) VALUES ($1, $2, now()) RETURNING id`,
      [uuidV7(), `${randomUUID()}@kore.local`],
    );
    return rows[0].id;
  }

  async function referrer(): Promise<{ userId: string; referrerId: string }> {
    const userId = await user();
    const referrerId = uuidV7();
    await owner.query(
      `INSERT INTO referrers (id, updated_at, user_id, kind, referral_code, rate_percent)
       VALUES ($1, now(), $2, 'planner', $3, 20)`,
      [referrerId, userId, `f3-${randomUUID()}`],
    );
    return { userId, referrerId };
  }

  async function wedding(referrerId: string | null): Promise<string> {
    const id = uuidV7();
    await owner.query(
      `INSERT INTO weddings (id, updated_at, slug, status, event_date, timezone, city, state,
         created_by_user_id, signup_source, referrer_id, referral_source)
       VALUES ($1, now(), $2, 'draft', '2026-11-14', 'America/Sao_Paulo', 'Campinas', 'SP', $3,
         'direct', $4, $5)`,
      [id, `f3-${randomUUID()}`, ana, referrerId, referrerId ? 'referral_link' : null],
    );
    return id;
  }

  async function member(wedding: string, userId: string, role: 'owner' | 'collaborator') {
    await owner.query(
      `INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, $4)`,
      [uuidV7(), wedding, userId, role],
    );
  }

  beforeAll(async () => {
    api = new Client({ connectionString: process.env.DATABASE_URL });
    owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
    await Promise.all([api.connect(), owner.connect()]);
    [ana, marcos, stranger] = [await user(), await user(), await user()];
    [juliana, clara] = [await referrer(), await referrer()];
    weddingId = await wedding(juliana.referrerId);
    otherWeddingId = await wedding(null);
    await member(weddingId, ana, 'owner');
    await member(weddingId, marcos, 'owner');
    await member(weddingId, juliana.userId, 'collaborator');
    await member(otherWeddingId, ana, 'owner');
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

  /** Transação do dono do schema, desfeita no fim (os casos não se somam). */
  async function asOwner<T>(work: () => Promise<T>): Promise<T> {
    await owner.query('BEGIN');
    try {
      return await work();
    } finally {
      await owner.query('ROLLBACK');
    }
  }

  async function rejects(client: Client, sql: string, params: unknown[], pattern: RegExp) {
    await client.query('SAVEPOINT s');
    await expect(client.query(sql, params)).rejects.toThrow(pattern);
    await client.query('ROLLBACK TO SAVEPOINT s');
  }

  const RLS = /row-level security/;
  const DENIED = /permission denied/;
  const CHECK = /violates check constraint/;
  const UNIQUE = /duplicate key value/;

  type PaymentRow = {
    id?: string;
    wedding?: string;
    kind?: 'publication' | 'extension';
    status?: string;
    method?: 'pix' | 'card';
    installments?: number;
    amount?: number;
    activation?: number;
    referral?: number;
    pix?: number;
    periodStart?: string;
    createdBy?: string | null;
    paidAt?: string | null;
    appliedAt?: string | null;
  };

  /** Publicação de 7 meses no cartão, com o desconto da assessoria: R$ 337,10. */
  function insertPayment(client: Client, row: PaymentRow = {}) {
    const id = row.id ?? uuidV7();
    const kind = row.kind ?? 'publication';
    return client.query(
      `INSERT INTO payments (id, updated_at, wedding_id, kind, status, method, installments,
         price_version, period_start, period_end, months_covered, activation_list_cents,
         monthly_list_cents, referral_discount_cents, pix_discount_cents, amount_cents, gateway,
         external_reference, payer_name, payer_tax_id_hash, payer_tax_id_hash_version,
         payer_tax_id_last4, idempotency_key, request_hash, created_by_user_id, paid_at, applied_at)
       VALUES ($1::uuid, now(), $2, $3, $4, $5, $6, '2026-11', $7, '2027-02-14', 7, $8, 2900, $9, $10,
         $11, 'local', $1::text, 'Ana Beatriz Moreira', 'hash', 1, '4821', $12, 'body', $13, $14, $15)
       RETURNING id`,
      [
        id,
        row.wedding ?? weddingId,
        kind,
        row.status ?? 'pending',
        row.method ?? 'card',
        row.installments ?? 2,
        row.periodStart ?? '2026-08-10',
        row.activation ?? (kind === 'publication' ? 14900 : 0),
        row.referral ?? (kind === 'publication' ? 1490 : 0),
        row.pix ?? 0,
        row.amount ?? (kind === 'publication' ? 33710 : 20300),
        randomUUID(),
        row.createdBy === undefined ? ana : row.createdBy,
        row.paidAt ?? null,
        row.appliedAt ?? null,
      ],
    );
  }

  describe('Payment (Publicar e pagar RN20; G3)', () => {
    it('RN20 - o dono cria o pendente e lê; a colaboradora e quem não é do casamento não veem', async () => {
      const id = uuidV7();
      await as(ana, async () => {
        await insertPayment(api, { id });
        expect((await api.query('SELECT 1 FROM payments WHERE id = $1', [id])).rowCount).toBe(1);
      });
      // As outras pessoas leem pela conexão da API: o pagamento precisa estar confirmado.
      await insertPayment(owner, { id });
      try {
        for (const userId of [juliana.userId, stranger]) {
          await as(userId, async () => {
            expect((await api.query('SELECT 1 FROM payments WHERE id = $1', [id])).rowCount).toBe(
              0,
            );
          });
        }
      } finally {
        await owner.query('DELETE FROM payments WHERE id = $1', [id]);
      }
    });

    it('RN20 - o kore_app não muda estado, valores nem campos do gateway, e não apaga', async () => {
      await as(ana, async () => {
        const id = uuidV7();
        await insertPayment(api, { id });
        await rejects(api, `UPDATE payments SET status = 'paid' WHERE id = $1`, [id], DENIED);
        await rejects(
          api,
          `UPDATE payments SET gateway_payment_id = 'pay_1' WHERE id = $1`,
          [id],
          DENIED,
        );
        await rejects(api, 'DELETE FROM payments WHERE id = $1', [id], DENIED);
      });
    });

    it('RN20 - o kore_app só insere pendente, em nome próprio e num casamento de que é dono', async () => {
      await as(ana, async () => {
        await api.query('SAVEPOINT s');
        await expect(insertPayment(api, { status: 'paid', paidAt: '2026-08-10' })).rejects.toThrow(
          RLS,
        );
        await api.query('ROLLBACK TO SAVEPOINT s');
        await expect(insertPayment(api, { createdBy: marcos })).rejects.toThrow(RLS);
      });
      await as(juliana.userId, async () => {
        await expect(insertPayment(api, { createdBy: juliana.userId })).rejects.toThrow(RLS);
      });
    });

    it('RN12 - o total tem de bater com as linhas da cotação (CHECK, B2-19)', async () => {
      await asOwner(async () => {
        await owner.query('SAVEPOINT s');
        await expect(insertPayment(owner, { amount: 33711 })).rejects.toThrow(CHECK);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        // Pix: 7 meses sem indicação = R$ 341,44 (Preço RN01).
        await insertPayment(owner, {
          method: 'pix',
          installments: 1,
          referral: 0,
          pix: 1056,
          amount: 34144,
          wedding: otherWeddingId,
        });
        await owner.query('SAVEPOINT s');
        // Pix parcelado não existe.
        await expect(
          insertPayment(owner, {
            method: 'pix',
            installments: 2,
            kind: 'extension',
            amount: 20300,
          }),
        ).rejects.toThrow(CHECK);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        // A extensão não tem ativação.
        await expect(
          insertPayment(owner, { kind: 'extension', activation: 14900, amount: 35200 }),
        ).rejects.toThrow(CHECK);
      });
    });

    it('RN07 - um pendente por casamento e tipo', async () => {
      await asOwner(async () => {
        await insertPayment(owner);
        await insertPayment(owner, { kind: 'extension', periodStart: '2026-11-20' });
        await expect(insertPayment(owner)).rejects.toThrow(UNIQUE);
      });
    });

    it('RN08 e RN10 - o Pix pago depois fica pago sem ser aplicado, ao lado da publicação aplicada (B2-2)', async () => {
      await asOwner(async () => {
        const paid = { status: 'paid', paidAt: '2026-08-10T15:00:00Z' };
        await insertPayment(owner, { ...paid, appliedAt: '2026-08-10T15:00:00Z' });
        // O Pix cancelado que o gateway confirmou depois: pago, sem appliedAt.
        await insertPayment(owner, {
          ...paid,
          method: 'pix',
          installments: 1,
          pix: 1011,
          amount: 32699,
        });
        // Uma segunda publicação aplicada não cabe.
        await owner.query('SAVEPOINT s');
        await expect(
          insertPayment(owner, { ...paid, appliedAt: '2026-08-10T15:00:00Z' }),
        ).rejects.toThrow(UNIQUE);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        // Uma extensão aplicada por início de período.
        const extension = {
          ...paid,
          kind: 'extension' as const,
          periodStart: '2026-11-20',
          appliedAt: '2026-08-10T15:00:00Z',
        };
        await insertPayment(owner, extension);
        await expect(insertPayment(owner, extension)).rejects.toThrow(UNIQUE);
      });
    });

    it('RN10 - appliedAt só com o dinheiro recebido', async () => {
      await asOwner(async () => {
        await expect(insertPayment(owner, { appliedAt: '2026-08-10T15:00:00Z' })).rejects.toThrow(
          CHECK,
        );
      });
    });

    it('RN06 - "Aguardando pagamento" só em booleano, para quem tem vínculo ou indicou', async () => {
      // A função roda pela conexão da API: o pagamento precisa estar confirmado.
      const paymentId = uuidV7();
      await insertPayment(owner, { id: paymentId });
      try {
        const awaiting = (userId: string) =>
          as(userId, async () => {
            const { rows } = await api.query<{ awaiting: boolean | null }>(
              'SELECT wedding_awaiting_payment($1) AS awaiting',
              [weddingId],
            );
            return rows[0].awaiting;
          });
        expect(await awaiting(juliana.userId)).toBe(true);
        expect(await awaiting(stranger)).toBeNull();
        expect(await awaiting(clara.userId)).toBeNull();
      } finally {
        await owner.query('DELETE FROM payments WHERE wedding_id = $1', [weddingId]);
      }
    });
  });

  describe('Tabelas só do worker (G3)', () => {
    it.each([
      'gateway_events',
      'gateway_customers',
      'alerts',
      'support_sessions',
      'courtesy_extensions',
      'billing_notice_logs',
    ])('RN20 - o kore_app não lê nem grava %s', async (table) => {
      await as(ana, async () => {
        await rejects(api, `SELECT 1 FROM ${table}`, [], DENIED);
      });
    });

    it('Backoffice - acesso RN12 - um alerta aberto por tipo e entidade (B9-7)', async () => {
      await asOwner(async () => {
        const alert = `INSERT INTO alerts (id, type, entity_type, entity_id, wedding_id)
                       VALUES ($1, 'orphan_payment', 'payment', 'p-1', $2)`;
        await owner.query(alert, [uuidV7(), weddingId]);
        await owner.query('SAVEPOINT s');
        await expect(owner.query(alert, [uuidV7(), weddingId])).rejects.toThrow(UNIQUE);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        await owner.query(
          `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE entity_id = 'p-1'`,
        );
        await owner.query(alert, [uuidV7(), weddingId]);
      });
    });
  });

  describe('Comissão, ajuste, repasse e chave Pix (Comissões RN10; Repasse; G3)', () => {
    async function seedReferrerData(client: Client) {
      const paymentId = uuidV7();
      await insertPayment(client, {
        id: paymentId,
        status: 'paid',
        paidAt: '2026-08-10T15:00:00Z',
        appliedAt: '2026-08-10T15:00:00Z',
      });
      const commissionId = uuidV7();
      await client.query(
        `INSERT INTO commissions (id, updated_at, referrer_id, wedding_id, payment_id,
           base_amount_cents, rate_percent, amount_cents, status, available_at)
         VALUES ($1, now(), $2, $3, $4, 33710, 20, 6742, 'pending', '2026-09-09T15:00:00Z')`,
        [commissionId, juliana.referrerId, weddingId, paymentId],
      );
      const pixKeyId = uuidV7();
      await client.query(
        `INSERT INTO referrer_pix_keys (id, updated_at, referrer_id, key_type, key_encrypted,
           key_hash, key_masked, status)
         VALUES ($1, now(), $2, 'email', 'cifrado', 'hash', 'jul***@prado.com.br', 'active')`,
        [pixKeyId, juliana.referrerId],
      );
      return { paymentId, commissionId, pixKeyId };
    }

    it('RN10 - cada indicador lê só as próprias comissões, sem gravar', async () => {
      // A API lê pela própria conexão: os dados precisam estar confirmados.
      const { commissionId, paymentId, pixKeyId } = await seedReferrerData(owner);
      try {
        await as(juliana.userId, async () => {
          expect(
            (await api.query('SELECT 1 FROM commissions WHERE id = $1', [commissionId])).rowCount,
          ).toBe(1);
          await rejects(
            api,
            `UPDATE commissions SET status = 'available' WHERE id = $1`,
            [commissionId],
            DENIED,
          );
          await rejects(
            api,
            `INSERT INTO commission_adjustments (id, referrer_id, amount_cents, reason)
             VALUES ($1, $2, 100, 'manual')`,
            [uuidV7(), juliana.referrerId],
            DENIED,
          );
        });
        await as(clara.userId, async () => {
          expect((await api.query('SELECT 1 FROM commissions')).rowCount).toBe(0);
          expect((await api.query('SELECT 1 FROM referrer_pix_keys')).rowCount).toBe(0);
        });
      } finally {
        await owner.query('DELETE FROM commissions WHERE id = $1', [commissionId]);
        await owner.query('DELETE FROM referrer_pix_keys WHERE id = $1', [pixKeyId]);
        await owner.query('DELETE FROM payments WHERE id = $1', [paymentId]);
      }
    });

    it('Repasse RN03 - a chave Pix só sai mascarada; o CPF do indicador não sai', async () => {
      await as(juliana.userId, async () => {
        await rejects(api, 'SELECT key_encrypted FROM referrer_pix_keys', [], DENIED);
        await rejects(api, 'SELECT confirm_token_hash FROM referrer_pix_keys', [], DENIED);
        await api.query('SELECT key_masked, status FROM referrer_pix_keys');
        await rejects(api, 'SELECT tax_id_encrypted FROM referrers', [], DENIED);
        await rejects(api, 'SELECT tax_id_hash FROM referrers', [], DENIED);
        await api.query('SELECT id, referral_code, tax_id_type FROM referrers WHERE id = $1', [
          juliana.referrerId,
        ]);
      });
    });

    it('Repasse RN04 - um repasse aberto por indicador e o mínimo de R$ 50', async () => {
      await asOwner(async () => {
        const { pixKeyId } = await seedReferrerData(owner);
        const payout = (amount: number) =>
          owner.query(
            `INSERT INTO payouts (id, updated_at, referrer_id, amount_cents, pix_key_id,
               pix_key_masked, external_ref, idempotency_key, requested_at)
             VALUES ($1::uuid, now(), $2, $3, $4, 'jul***', $1::text, $5, now())`,
            [uuidV7(), juliana.referrerId, amount, pixKeyId, randomUUID()],
          );
        await owner.query('SAVEPOINT s');
        await expect(payout(4999)).rejects.toThrow(CHECK);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        await payout(15804);
        await expect(payout(5000)).rejects.toThrow(UNIQUE);
      });
    });

    it('Comissões RN01 - uma comissão por pagamento, sempre positiva', async () => {
      await asOwner(async () => {
        const { paymentId } = await seedReferrerData(owner);
        const commission = (amount: number) =>
          owner.query(
            `INSERT INTO commissions (id, updated_at, referrer_id, wedding_id, payment_id,
               base_amount_cents, rate_percent, amount_cents, status, available_at)
             VALUES ($1, now(), $2, $3, $4, 33710, 0, $5, 'pending', now())`,
            [uuidV7(), juliana.referrerId, weddingId, paymentId, amount],
          );
        await owner.query('SAVEPOINT s');
        await expect(commission(0)).rejects.toThrow(CHECK);
        await owner.query('ROLLBACK TO SAVEPOINT s');
        await expect(commission(100)).rejects.toThrow(UNIQUE);
      });
    });
  });

  describe('Central (Publicar e pagar RN13; Comissões RN09; G6)', () => {
    async function notify(userId: string, type: string): Promise<string> {
      const id = uuidV7();
      await owner.query(
        `INSERT INTO notifications (id, user_id, wedding_id, type, group_key, payload)
         VALUES ($1, $2, $3, $4, $5, '[]')`,
        [id, userId, weddingId, type, `${type}:${id}`],
      );
      return id;
    }

    it('RN13 - o billing é só dos donos; o commission e o referrer_reassigned, de quem recebe', async () => {
      const ids = [
        await notify(ana, 'billing'),
        await notify(juliana.userId, 'billing'),
        await notify(juliana.userId, 'commission'),
        await notify(clara.userId, 'referrer_reassigned'),
      ];
      try {
        const visible = (userId: string) =>
          as(userId, async () =>
            (
              await api.query<{ type: string }>(
                'SELECT type FROM notifications WHERE id = ANY($1) ORDER BY type',
                [ids],
              )
            ).rows.map((row) => row.type),
          );
        expect(await visible(ana)).toEqual(['billing']);
        // A colaboradora não vê o billing, nem o que foi gravado em nome dela.
        expect(await visible(juliana.userId)).toEqual(['commission']);
        expect(await visible(clara.userId)).toEqual(['referrer_reassigned']);
      } finally {
        await owner.query('DELETE FROM notifications WHERE id = ANY($1)', [ids]);
      }
    });
  });

  describe('Casamento (Data de saída do ar; Retenção RN03 e RN04; Casamento bloqueado)', () => {
    it('Retenção RN04 - o fuso fica na lista do mapa de UF', async () => {
      await asOwner(async () => {
        await rejects(
          owner,
          `UPDATE weddings SET timezone = 'America/Sao_Paul' WHERE id = $1`,
          [weddingId],
          CHECK,
        );
        await owner.query(`UPDATE weddings SET timezone = 'America/Rio_Branco' WHERE id = $1`, [
          weddingId,
        ]);
      });
    });

    it('Retenção RN03 - a lápide zera as colunas da F3', async () => {
      await asOwner(async () => {
        await rejects(
          owner,
          `UPDATE weddings SET status = 'purged', purged_at = now(), slug = NULL,
             blocked_at = now() WHERE id = $1`,
          [otherWeddingId],
          CHECK,
        );
      });
    });

    it('Casamento bloqueado - as colunas do bloqueio e da exclusão não têm GRANT ao kore_app', async () => {
      await as(ana, async () => {
        await rejects(
          api,
          `UPDATE weddings SET blocked_at = now() WHERE id = $1`,
          [weddingId],
          DENIED,
        );
        await rejects(
          api,
          `UPDATE weddings SET deletion_scheduled_for = '2026-11-21' WHERE id = $1`,
          [weddingId],
          DENIED,
        );
        await rejects(
          api,
          `UPDATE weddings SET grace_until = NULL WHERE id = $1`,
          [weddingId],
          DENIED,
        );
      });
    });

    it('Data de saída do ar RN02 - a carência e o expirado vêm depois da data de saída', async () => {
      await asOwner(async () => {
        await rejects(
          owner,
          `UPDATE weddings SET status = 'grace', end_date = '2027-02-14', grace_until = '2027-02-14'
           WHERE id = $1`,
          [weddingId],
          CHECK,
        );
      });
    });
  });
});
