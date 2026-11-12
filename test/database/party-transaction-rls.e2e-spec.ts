import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * A transação do grupo direto no SQL (RSVP RN13; decisão 217(a)), com o
 * usuário real da API (kore_api) no papel do grupo (kore_party), sem pessoa:
 * app.wedding_id e app.party_id abrem só o grupo do cookie, e só as colunas
 * do RSVP. Cada caso numa transação desfeita.
 */
describe('Transação do grupo (banco real, usuário kore_api sem sessão)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let weddingId: string;
  let otherWeddingId: string;
  let moreira: { id: string; linkVersion: number };
  let duarte: string; // outro grupo do mesmo casamento
  let foreign: string; // grupo de outro casamento
  let celia: string;
  let carla: string; // da Família Duarte

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    weddingId = (await seedWedding({ db, ownerId: await user() })).weddingId;
    otherWeddingId = (await seedWedding({ db, ownerId: await user() })).weddingId;
    await db.wedding.updateMany({
      where: { id: { in: [weddingId, otherWeddingId] } },
      data: { status: 'published', publishedAt: new Date() },
    });
    const party = (wedding: string, name: string) =>
      db.party.create({
        data: { weddingId: wedding, name, linkToken: randomBytes(16).toString('base64url') },
      });
    moreira = await party(weddingId, 'Família Moreira');
    duarte = (await party(weddingId, 'Família Duarte')).id;
    foreign = (await party(otherWeddingId, 'Família Lima')).id;
    celia = (
      await db.guest.create({ data: { weddingId, partyId: moreira.id, name: 'Célia Moreira' } })
    ).id;
    carla = (await db.guest.create({ data: { weddingId, partyId: duarte, name: 'Carla Duarte' } }))
      .id;
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function asParty<T>(
    { wedding = weddingId, party = moreira.id }: { wedding?: string; party?: string },
    work: () => Promise<T>,
  ): Promise<T> {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.wedding_id', $1, true)`, [wedding]);
      await api.query(`SELECT set_config('app.party_id', $1, true)`, [party]);
      await api.query('SET LOCAL ROLE kore_party');
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  async function rejects(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
    await api.query('SAVEPOINT s');
    await expect(api.query(sql, params)).rejects.toThrow(pattern);
    await api.query('ROLLBACK TO SAVEPOINT s');
  }

  const context = async (version: number) =>
    (await api.query('SELECT party_transaction_context($1) AS context', [version])).rows[0]
      .context as Record<string, unknown> | null;

  it('RSVP RN13 - a primeira consulta reconfere grupo, versão do link, lixeira e o casamento no ar', async () => {
    await asParty({}, async () => {
      expect(await context(moreira.linkVersion)).toMatchObject({
        status: 'published',
        timezone: 'America/Sao_Paulo',
        rsvpDeadline: null,
        songQuestionEnabled: false,
      });
      expect(await context(moreira.linkVersion + 1)).toBeNull();
    });
    // O grupo de outro casamento com o casamento errado.
    await asParty({ party: foreign }, async () => {
      expect(await context(1)).toBeNull();
    });
    await db.party.update({ where: { id: duarte }, data: { deletedAt: new Date() } });
    await asParty({ party: duarte }, async () => {
      expect(await context(1)).toBeNull();
    });
    await db.party.update({ where: { id: duarte }, data: { deletedAt: null } });
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'draft' } });
    await asParty({}, async () => {
      expect(await context(moreira.linkVersion)).toBeNull();
    });
    await db.wedding.update({ where: { id: weddingId }, data: { status: 'published' } });
  });

  it('RSVP RN13 - o grupo lê e muda só a própria linha e os próprios convidados', async () => {
    await asParty({}, async () => {
      const parties = await api.query('SELECT id FROM parties');
      expect(parties.rows).toEqual([{ id: moreira.id }]);
      const guests = await api.query('SELECT id FROM guests');
      expect(guests.rows).toEqual([{ id: celia }]);
      const updated = await api.query(
        `UPDATE parties SET version = version + 1, first_viewed_at = now() WHERE id = ANY($1)`,
        [[moreira.id, duarte, foreign]],
      );
      expect(updated.rowCount).toBe(1);
      const answered = await api.query(
        `UPDATE guests SET rsvp_status = 'confirmed', responded_at = now() WHERE id = ANY($1)`,
        [[celia, carla]],
      );
      expect(answered.rowCount).toBe(1);
      // Não tira o convidado do grupo nem muda coluna fora do GRANT.
      await rejects(
        'UPDATE guests SET party_id = $2 WHERE id = $1',
        [celia, duarte],
        /permission denied/,
      );
      // O papel do grupo não herda as colunas da API (T3).
      for (const column of [
        'name',
        'plus_one_slots',
        'contact_guest_id',
        'internal_note',
        'link_version',
        'deleted_at',
        'sent_at',
      ])
        await rejects(
          `UPDATE parties SET ${column} = ${column} WHERE id = $1`,
          [moreira.id],
          /permission denied/,
        );
      for (const column of ['email', 'phone', 'age_group', 'is_plus_one', 'deleted_at'])
        await rejects(
          `UPDATE guests SET ${column} = ${column} WHERE id = $1`,
          [celia],
          /permission denied/,
        );
      // O casamento e as outras tabelas ficam fora.
      await rejects('SELECT id FROM weddings', [], /permission denied/);
      await rejects('SELECT id FROM tags', [], /permission denied/);
    });
  });

  it('RSVP RN07 e RN10 - o grupo insere o próprio histórico como grupo e lê as próprias gravações', async () => {
    await asParty({}, async () => {
      const submissionId = uuidV7();
      await api.query(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, signed_by_guest_id,
           confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'party', $4, 1, 0)`,
        [submissionId, weddingId, moreira.id, celia],
      );
      await api.query(
        `INSERT INTO guest_responses (id, wedding_id, guest_id, party_id, submission_id, status,
           signed_by_guest_id, actor)
         VALUES ($1, $2, $3, $4, $5, 'confirmed', $3, 'party')`,
        [uuidV7(), weddingId, celia, moreira.id, submissionId],
      );
      expect((await api.query('SELECT id FROM rsvp_submissions')).rows).toEqual([
        { id: submissionId },
      ]);
      // Não grava pelo outro grupo, nem como casal.
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'party', 0, 0)`,
        [uuidV7(), weddingId, duarte],
        /row-level security/,
      );
      await rejects(
        `INSERT INTO rsvp_submissions (id, wedding_id, party_id, actor, confirmed_count, declined_count)
         VALUES ($1, $2, $3, 'couple', 0, 0)`,
        [uuidV7(), weddingId, moreira.id],
        /row-level security/,
      );
      // A notificação não é escrita pelo grupo (só pela notify_rsvp, no PR do RSVP).
      await rejects(
        `INSERT INTO notifications (id, user_id, wedding_id, type, group_key, payload)
         VALUES ($1, $2, $3, 'rsvp', 'x', '[]')`,
        [uuidV7(), randomUUID(), weddingId],
        /permission denied/,
      );
    });
  });

  it('RSVP RN07 - o grupo atualiza os números só do próprio casamento', async () => {
    await asParty({}, async () => {
      const stats = await api.query(
        'UPDATE wedding_stats SET confirmed = confirmed + 1 WHERE wedding_id = ANY($1)',
        [[weddingId, otherWeddingId]],
      );
      expect(stats.rowCount).toBe(1);
    });
  });

  it('RSVP RN13 - sem app.party_id, nada do grupo aparece (falha fechada)', async () => {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.wedding_id', $1, true)`, [weddingId]);
      await api.query('SET LOCAL ROLE kore_party');
      expect((await api.query('SELECT id FROM parties')).rows).toEqual([]);
      expect((await api.query('SELECT wedding_id FROM wedding_stats')).rows).toEqual([]);
      expect(await context(moreira.linkVersion)).toBeNull();
    } finally {
      await api.query('ROLLBACK');
    }
  });

  it('RSVP RN13 - as policies do grupo valem só no papel do grupo: a API com app.party_id não vê nada', async () => {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.wedding_id', $1, true)`, [weddingId]);
      await api.query(`SELECT set_config('app.party_id', $1, true)`, [moreira.id]);
      expect((await api.query('SELECT id FROM parties')).rows).toEqual([]);
      expect((await api.query('SELECT id FROM guests')).rows).toEqual([]);
      await rejects('SELECT party_transaction_context(1)', [], /permission denied/);
    } finally {
      await api.query('ROLLBACK');
    }
  });
});
