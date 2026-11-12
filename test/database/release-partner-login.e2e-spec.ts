import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/** release_partner_login (decisão 177, item 10), com o usuário real da API (kore_api). */
describe('Função release_partner_login (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  it('só solta o login do noivo da própria pessoa, e só depois de ela ter saído', async () => {
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    const [ana, marcos] = [await user(), await user()];
    const { weddingId } = await seedWedding({ db, ownerId: ana });
    await db.membership.create({ data: { weddingId, userId: marcos, role: 'owner' } });
    await db.partner.updateMany({ where: { weddingId, slot: 2 }, data: { userId: marcos } });
    const release = async (userId: string) => {
      await api.query('BEGIN');
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      await api.query('SELECT release_partner_login($1)', [weddingId]);
      await api.query('COMMIT');
    };
    const partnerUser = async (slot: number) =>
      (await db.partner.findFirstOrThrow({ where: { weddingId, slot } })).userId;

    await release(marcos); // ainda é dono: nada muda
    expect(await partnerUser(2)).toBe(marcos);
    await db.membership.updateMany({
      where: { weddingId, userId: marcos },
      data: { removedAt: new Date() },
    });
    await release(ana); // a outra pessoa não solta o login dele
    expect(await partnerUser(2)).toBe(marcos);
    await release(marcos);
    expect(await partnerUser(2)).toBeNull();
    expect(await partnerUser(1)).toBe(ana);
  });
});
