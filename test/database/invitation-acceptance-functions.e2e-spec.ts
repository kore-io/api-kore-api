import { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedWedding } from '../support/weddings';

const hash = (token: string) => createHash('sha256').update(token).digest('base64url');

/**
 * As funções do aceite e da recusa (decisão 172), direto no SQL com o usuário
 * real da API (kore_api): só agem pelo hash de um convite pendente, para a
 * pessoa da transação, e as barreiras do banco valem mesmo sem o domínio.
 */
describe('Funções do aceite e da recusa do convite (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string;
  let marcos: string;
  let weddingId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, marcos] = [await user(), await user()];
    weddingId = (await seedWedding({ db, ownerId: ana })).weddingId;
    await db.partner.updateMany({ where: { weddingId, slot: 2 }, data: { title: null } });
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function as<T>(userId: string | null, work: () => Promise<T>): Promise<T> {
    await api.query('BEGIN');
    try {
      if (userId) await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  const acceptSql = (token: string, slot: number | null = 2, title: string | null = 'groom') =>
    api.query(
      `SELECT * FROM accept_access_invitation($1, $2::uuid, $3::smallint, $4::partner_title, NULL)`,
      [hash(token), uuidV7(), slot, title],
    );
  const partnerInvitation = () =>
    seedInvitation({
      db,
      weddingId,
      kind: 'partner',
      email: `${randomUUID()}@kore.local`,
      invitedByUserId: ana,
    });

  it('a leitura pelo token funciona sem vínculo (e sem pessoa), e o token desconhecido dá nulo', async () => {
    const { token } = await partnerInvitation();

    await as(null, async () => {
      const { rows } = await api.query<{ invitation: { weddingId: string; kind: string } | null }>(
        'SELECT access_invitation_by_token($1) AS invitation',
        [hash(token)],
      );
      expect(rows[0]?.invitation).toMatchObject({ weddingId, kind: 'partner' });
      const unknown = await api.query('SELECT access_invitation_by_token($1) AS invitation', ['x']);
      expect(unknown.rows[0]).toEqual({ invitation: null });
    });
  });

  it('o aceite exige a pessoa na transação', async () => {
    const { token } = await partnerInvitation();

    await as(null, async () => {
      await expect(acceptSql(token)).rejects.toThrow(/no user/);
    });
  });

  it('RN08 - aceita para a pessoa da transação: vínculo de dono, noivo com login e convite aceito, uma vez só', async () => {
    const { token } = await partnerInvitation();

    await as(marcos, async () => {
      const { rows } = await acceptSql(token);
      expect(rows).toEqual([{ wedding_id: weddingId, attributed: false }]);
      const membership = await api.query(
        `SELECT role FROM memberships WHERE wedding_id = $1 AND user_id = $2`,
        [weddingId, marcos],
      );
      expect(membership.rows).toEqual([{ role: 'owner' }]);
      await expect(acceptSql(token)).rejects.toThrow(/not pending/);
    });
  });

  it('RN08 - o banco barra o terceiro dono e o noivo que já tem login, mesmo sem o domínio', async () => {
    const { token } = await partnerInvitation();
    const third = (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;

    await as(third, async () => {
      await expect(acceptSql(token, 1, null)).rejects.toThrow(/partner taken/);
    });
    await db.membership.create({ data: { weddingId, userId: marcos, role: 'owner' } });
    try {
      await as(third, async () => {
        await expect(acceptSql(token)).rejects.toThrow(/owners full/);
      });
    } finally {
      await db.membership.deleteMany({ where: { weddingId, userId: marcos } });
    }
  });

  it('a API não grava o aceite por fora das funções', async () => {
    await as(ana, async () => {
      await api.query('SAVEPOINT s');
      await expect(
        api.query('UPDATE partners SET user_id = $1 WHERE wedding_id = $2 AND slot = 2', [
          marcos,
          weddingId,
        ]),
      ).rejects.toThrow(/permission denied/);
      await api.query('ROLLBACK TO SAVEPOINT s');
      await expect(
        api.query(`UPDATE weddings SET referral_source = 'invited_before_payment' WHERE id = $1`, [
          weddingId,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  it('RN11 - a recusa só vale para convite por e-mail pendente; o link sem e-mail não é recusado', async () => {
    const byEmail = await partnerInvitation();
    const link = await seedInvitation({
      db,
      weddingId,
      kind: 'couple',
      email: null,
      invitedByUserId: ana,
    });

    await as(null, async () => {
      const decline = async (token: string) =>
        (
          await api.query<{ declined: boolean | null }>(
            'SELECT decline_access_invitation($1) AS declined',
            [hash(token)],
          )
        ).rows[0]?.declined;
      expect(await decline(link.token)).toBeNull();
      expect(await decline(byEmail.token)).toBe(true);
      expect(await decline(byEmail.token)).toBeNull();
    });
  });
});
