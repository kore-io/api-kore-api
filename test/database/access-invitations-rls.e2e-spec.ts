import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

/**
 * RLS dos convites de acesso e a brecha do cadastro (decisões 153 e 168), direto
 * no SQL com o usuário real da API (kore_api). Cada caso numa transação desfeita.
 */
describe('RLS dos convites de acesso (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string; // dona do casamento do casal
  let colaboradora: string;
  let estranha: string;
  let juliana: string; // cerimonialista que criou o casamento para o casal
  let coupleWeddingId: string;
  let plannerWeddingId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, colaboradora, estranha] = [await user(), await user(), await user()];
    coupleWeddingId = (await seedWedding({ db, ownerId: ana, collaboratorIds: [colaboradora] }))
      .weddingId;
    juliana = (await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' })).userId;
    plannerWeddingId = (await seedReferrerWedding({ db, referrerUserId: juliana })).weddingId;
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

  const insert = ({
    weddingId,
    kind,
    invitedBy,
    email = `${randomUUID()}@kore.local`,
  }: {
    weddingId: string;
    kind: 'partner' | 'couple' | 'planner';
    invitedBy: string;
    email?: string | null;
  }) =>
    api
      .query(
        `INSERT INTO access_invitations (id, wedding_id, kind, email, role, token_hash,
           invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '30 days')`,
        [
          uuidV7(),
          weddingId,
          kind,
          email,
          kind === 'planner' ? 'collaborator' : 'owner',
          randomUUID(),
          invitedBy,
        ],
      )
      .then(() => undefined);

  it('RN02 - o dono insere convite de parceiro e de cerimonialista; o colaborador, não', async () => {
    await as(ana, async () => {
      await insert({ weddingId: coupleWeddingId, kind: 'partner', invitedBy: ana });
      await insert({ weddingId: coupleWeddingId, kind: 'planner', invitedBy: ana });
    });
    await as(colaboradora, async () => {
      await expect(
        insert({ weddingId: coupleWeddingId, kind: 'partner', invitedBy: colaboradora }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('RN02 - o convite do casal, só o indicador que criou o casamento sem dono', async () => {
    await as(juliana, async () => {
      await insert({
        weddingId: plannerWeddingId,
        kind: 'couple',
        invitedBy: juliana,
        email: null,
      });
    });
    await as(ana, async () => {
      await expect(
        insert({ weddingId: coupleWeddingId, kind: 'couple', invitedBy: ana }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('ninguém insere convite em nome de outra pessoa, nem em casamento sem vínculo', async () => {
    await as(ana, async () => {
      await expect(
        insert({ weddingId: coupleWeddingId, kind: 'partner', invitedBy: colaboradora }),
      ).rejects.toThrow(/row-level security/);
    });
    await as(estranha, async () => {
      await expect(
        insert({ weddingId: coupleWeddingId, kind: 'partner', invitedBy: estranha }),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('RN04 - um pendente por e-mail e um link do casal pendente por casamento', async () => {
    await as(ana, async () => {
      await insert({
        weddingId: coupleWeddingId,
        kind: 'partner',
        invitedBy: ana,
        email: 'mesmo@kore.local',
      });
      await expect(
        insert({
          weddingId: coupleWeddingId,
          kind: 'planner',
          invitedBy: ana,
          email: 'MESMO@kore.local',
        }),
      ).rejects.toThrow(/uq_access_invitations_wedding_id_email_pending/);
    });
    await as(juliana, async () => {
      await insert({
        weddingId: plannerWeddingId,
        kind: 'couple',
        invitedBy: juliana,
        email: null,
      });
      await expect(
        insert({ weddingId: plannerWeddingId, kind: 'couple', invitedBy: juliana, email: null }),
      ).rejects.toThrow(/uq_access_invitations_wedding_id_couple_link_pending/);
    });
  });

  it('a pessoa só vê os convites dos casamentos em que tem vínculo, e a API só altera cancelamento e substituição', async () => {
    const token = randomUUID();
    await db.accessInvitation.create({
      data: {
        weddingId: coupleWeddingId,
        kind: 'partner',
        email: `${randomUUID()}@kore.local`,
        role: 'owner',
        tokenHash: token,
        invitedByUserId: ana,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const visible = () =>
      api.query('SELECT 1 FROM access_invitations WHERE token_hash = $1', [token]);

    await as(estranha, async () => expect((await visible()).rowCount).toBe(0));
    await as(ana, async () => {
      expect((await visible()).rowCount).toBe(1);
      await api.query('UPDATE access_invitations SET revoked_at = now() WHERE token_hash = $1', [
        token,
      ]);
      await expect(
        api.query('UPDATE access_invitations SET accepted_at = now() WHERE token_hash = $1', [
          token,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
    await as(ana, async () => {
      await expect(
        api.query('DELETE FROM access_invitations WHERE token_hash = $1', [token]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('decisão 168 - o indicador não vira dono pelo cadastro do casamento que criou para o casal', async () => {
    const weddingId = randomUUID();
    await db.wedding.create({
      data: {
        id: weddingId,
        slug: `sem-vinculo-${randomUUID()}`,
        status: 'draft',
        timezone: 'America/Sao_Paulo',
        city: 'Campinas',
        state: 'SP',
        createdByUserId: juliana,
        referralSource: 'created_by_planner',
        referrerId: (await db.referrer.findUniqueOrThrow({ where: { userId: juliana } })).id,
        signupSource: 'planner',
      },
    });

    await as(juliana, async () => {
      await expect(
        api.query(
          `INSERT INTO memberships (id, wedding_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
          [uuidV7(), weddingId, juliana],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
