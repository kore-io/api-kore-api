import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { createTestApp } from '../support/create-test-app';
import { seedWedding } from '../support/weddings';

/**
 * Migration da F1 (grupos, convidados, tags e números do casamento) direto no
 * SQL, com o usuário real da API (kore_api): RLS por vínculo (decisão 153), FKs
 * compostas, CHECKs e o gatilho do WeddingStats. Cada caso numa transação desfeita.
 */
describe('Migration da F1: convidados (banco real, usuário kore_api)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let api: Client;
  let ana: string; // dona
  let juliana: string; // cerimonialista (colaboradora)
  let estranha: string; // dona de outro casamento
  let weddingId: string;
  let otherWeddingId: string;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    const user = async () =>
      (await db.user.create({ data: { email: `${randomUUID()}@kore.local` } })).id;
    [ana, juliana, estranha] = [await user(), await user(), await user()];
    weddingId = (await seedWedding({ db, ownerId: ana, collaboratorIds: [juliana] })).weddingId;
    otherWeddingId = (await seedWedding({ db, ownerId: estranha })).weddingId;
    api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
  });

  afterAll(async () => {
    await api?.end();
    await app?.close();
  });

  async function as<T>(
    userId: string,
    work: () => Promise<T>,
    { currentWeddingId }: { currentWeddingId?: string } = {},
  ): Promise<T> {
    await api.query('BEGIN');
    try {
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      if (currentWeddingId)
        await api.query(`SELECT set_config('app.wedding_id', $1, true)`, [currentWeddingId]);
      return await work();
    } finally {
      await api.query('ROLLBACK');
    }
  }

  const insertParty = async ({
    wedding = weddingId,
    name = 'Família Moreira',
  }: { wedding?: string; name?: string } = {}): Promise<string> => {
    const id = uuidV7();
    await api.query(
      `INSERT INTO parties (id, wedding_id, name, link_token, updated_at)
       VALUES ($1, $2, $3, $4, now())`,
      [id, wedding, name, randomBytes(16).toString('base64url')],
    );
    return id;
  };

  const insertGuest = async ({
    partyId,
    wedding = weddingId,
    name = 'Célia Moreira',
    isPlusOne = false,
    phone = null,
  }: {
    partyId: string;
    wedding?: string;
    name?: string | null;
    isPlusOne?: boolean;
    phone?: string | null;
  }): Promise<string> => {
    const id = uuidV7();
    await api.query(
      `INSERT INTO guests (id, wedding_id, party_id, name, is_plus_one, phone, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [id, wedding, partyId, name, isPlusOne, phone],
    );
    return id;
  };

  const insertTag = async ({ name }: { name: string }): Promise<string> => {
    const id = uuidV7();
    await api.query(
      `INSERT INTO tags (id, wedding_id, name, updated_at) VALUES ($1, $2, $3, now())`,
      [id, weddingId, name],
    );
    return id;
  };

  const count = async (table: string): Promise<number> =>
    Number(
      (
        await api.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE wedding_id = $1`, [
          weddingId,
        ])
      ).rows[0].n,
    );

  describe('RLS por vínculo (Grupos RN02; decisão 186(4))', () => {
    it.each([
      ['a dona', () => ana],
      ['a cerimonialista', () => juliana],
    ])('RN02 - %s cria, lê e edita grupo, convidado e tag', async (_, who) => {
      await as(who(), async () => {
        const partyId = await insertParty();
        const guestId = await insertGuest({ partyId });
        const tagId = await insertTag({ name: 'Padrinhos' });
        await api.query(
          `INSERT INTO party_tags (wedding_id, party_id, tag_id) VALUES ($1, $2, $3)`,
          [weddingId, partyId, tagId],
        );
        await api.query(
          `INSERT INTO guest_tags (wedding_id, guest_id, tag_id) VALUES ($1, $2, $3)`,
          [weddingId, guestId, tagId],
        );
        await api.query(`UPDATE guests SET name = 'Célia M.' WHERE id = $1`, [guestId]);

        expect([await count('parties'), await count('guests'), await count('tags')]).toEqual([
          1, 1, 1,
        ]);
        expect([await count('party_tags'), await count('guest_tags')]).toEqual([1, 1]);
      });
    });

    it('RN02 - quem não tem vínculo não lê nem escreve (não encontrado)', async () => {
      await as(estranha, async () => {
        await expect(insertParty()).rejects.toThrow(/row-level security/);
      });
      // Um grupo gravado de verdade (pelo backoffice), que a estranha tenta ler e mudar.
      const committed = uuidV7();
      await db.party.create({
        data: {
          id: committed,
          weddingId,
          name: 'Amigos do vôlei',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      await as(estranha, async () => {
        expect(await count('parties')).toBe(0);
        const updated = await api.query(`UPDATE parties SET name = 'X' WHERE id = $1`, [committed]);
        expect(updated.rowCount).toBe(0);
      });
      await db.party.delete({ where: { id: committed } });
    });

    it('com o casamento da transação definido (app.wedding_id), só ele aparece', async () => {
      const committed = await db.party.create({
        data: {
          weddingId,
          name: 'Família Rocha',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      await as(ana, async () => expect(await count('parties')).toBe(1), {
        currentWeddingId: weddingId,
      });
      await as(ana, async () => expect(await count('parties')).toBe(0), {
        currentWeddingId: otherWeddingId,
      });
      await db.party.delete({ where: { id: committed.id } });
    });

    it('Lixeira RN01 - a API não apaga grupo, convidado nem tag (remoção lógica); tira o vínculo da tag', async () => {
      await as(ana, async () => {
        const partyId = await insertParty();
        const tagId = await insertTag({ name: 'Vizinhos' });
        await api.query(
          `INSERT INTO party_tags (wedding_id, party_id, tag_id) VALUES ($1, $2, $3)`,
          [weddingId, partyId, tagId],
        );
        await api.query(`DELETE FROM party_tags WHERE party_id = $1`, [partyId]);
        await api.query(`UPDATE parties SET deleted_at = now() WHERE id = $1`, [partyId]);
        await expect(api.query(`DELETE FROM parties WHERE id = $1`, [partyId])).rejects.toThrow(
          /permission denied/,
        );
      });
    });

    it('a API não troca o casamento de uma linha (GRANT por coluna)', async () => {
      await as(ana, async () => {
        const partyId = await insertParty();
        await expect(
          api.query(`UPDATE parties SET wedding_id = $1 WHERE id = $2`, [otherWeddingId, partyId]),
        ).rejects.toThrow(/permission denied/);
      });
    });
  });

  describe('FKs compostas (Modelo de Dados, invariantes 1 e 12.2)', () => {
    it('o convidado não aponta para um grupo de outro casamento', async () => {
      const otherParty = await db.party.create({
        data: {
          weddingId: otherWeddingId,
          name: 'Outro',
          linkToken: randomBytes(16).toString('base64url'),
        },
      });
      await as(ana, async () => {
        await expect(insertGuest({ partyId: otherParty.id })).rejects.toThrow(
          /guests_wedding_id_party_id_fkey/,
        );
      });
      await db.party.delete({ where: { id: otherParty.id } });
    });

    it('RN06 - o contato é um convidado do mesmo grupo; mover o contato exige trocar o contato na mesma transação', async () => {
      await as(ana, async () => {
        const moreira = await insertParty();
        const rocha = await insertParty({ name: 'Família Rocha' });
        const celia = await insertGuest({ partyId: moreira, phone: '+5519998761402' });
        const bruno = await insertGuest({ partyId: rocha, name: 'Bruno Lima' });

        await api.query(`UPDATE parties SET contact_guest_id = $1 WHERE id = $2`, [celia, moreira]);
        await api.query('SET CONSTRAINTS ALL IMMEDIATE');
        await api.query('SET CONSTRAINTS ALL DEFERRED');

        // Mover a Célia e trocar o contato juntos: passa.
        await api.query(`UPDATE guests SET party_id = $1 WHERE id = $2`, [rocha, celia]);
        await api.query(`UPDATE parties SET contact_guest_id = NULL WHERE id = $1`, [moreira]);
        await api.query('SET CONSTRAINTS ALL IMMEDIATE');
        await api.query('SET CONSTRAINTS ALL DEFERRED');

        // Contato de outro grupo: recusado na checagem.
        await api.query(`UPDATE parties SET contact_guest_id = $1 WHERE id = $2`, [bruno, moreira]);
        await expect(api.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toThrow(
          /parties_contact_guest_fkey/,
        );
      });
    });
  });

  describe('CHECKs e unicidade (Grupos RN04 e RN07; Tags RN02)', () => {
    it.each([
      ['nome de convidado nulo fora da vaga', { name: null }],
      ['vaga de acompanhante com nome vazio', { name: '', isPlusOne: true }],
      ['nome com mais de 80 caracteres', { name: 'a'.repeat(81) }],
      ['nome com espaço nas pontas', { name: ' Célia' }],
      ['telefone fora do E.164', { phone: '19998761402' }],
    ])('recusa %s', async (_, guest) => {
      await as(ana, async () => {
        const partyId = await insertParty();
        await expect(insertGuest({ partyId, ...guest })).rejects.toThrow(/chk_guests_/);
      });
    });

    it('RN07 - aceita a vaga de acompanhante sem nome; recusa mais de 5 vagas no grupo', async () => {
      await as(ana, async () => {
        const partyId = await insertParty();
        await insertGuest({ partyId, name: null, isPlusOne: true });
        await expect(
          api.query(`UPDATE parties SET plus_one_slots = 6 WHERE id = $1`, [partyId]),
        ).rejects.toThrow(/chk_parties_plus_one_slots/);
      });
    });

    it('RN04 - o nome do grupo não é único', async () => {
      await as(ana, async () => {
        await insertParty({ name: 'Família Silva' });
        await insertParty({ name: 'Família Silva' });
        expect(await count('parties')).toBe(2);
      });
    });

    it('Tags RN02 - nome único entre as ativas sem diferenciar maiúsculas; a tag na lixeira não impede', async () => {
      await as(ana, async () => {
        const padrinhos = await insertTag({ name: 'Padrinhos' });
        await api.query('SAVEPOINT antes');
        await expect(insertTag({ name: 'padrinhos' })).rejects.toThrow(
          /uq_tags_wedding_id_name_active/,
        );
        await api.query('ROLLBACK TO SAVEPOINT antes');
        await api.query(`UPDATE tags SET deleted_at = now() WHERE id = $1`, [padrinhos]);
        await insertTag({ name: 'padrinhos' });
        await expect(insertTag({ name: 'a'.repeat(41) })).rejects.toThrow(/chk_tags_name/);
      });
    });
  });

  describe('Busca sem acento (Grupos RN13; decisão 186(2))', () => {
    it('RN13 - f_unaccent normaliza para a busca e a ordem, e o índice funcional existe', async () => {
      const { rows } = await api.query<{ normalized: string }>(
        `SELECT lower(f_unaccent('Célia AÇÃO')) AS normalized`,
      );
      expect(rows[0].normalized).toBe('celia acao');

      const indexes = await api.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE indexname IN
           ('idx_parties_wedding_id_name_active', 'idx_guests_wedding_id_name_active')
         ORDER BY indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'idx_guests_wedding_id_name_active',
        'idx_parties_wedding_id_name_active',
      ]);
    });
  });

  describe('WeddingStats (Grupos RN16; decisões 186(3) e 188)', () => {
    it('RN16 - todo casamento novo nasce com a linha zerada (gatilho)', async () => {
      const stats = await db.weddingStats.findUniqueOrThrow({ where: { weddingId } });

      expect(stats).toMatchObject({ guestsTotal: 0, pending: 0, partiesPending: 0 });
      expect(Number(stats.rsvpPercent)).toBe(0);
    });

    it('RN16 - a API atualiza os contadores, e o rsvpPercent é calculado pelo banco', async () => {
      await as(ana, async () => {
        await api.query(
          `UPDATE wedding_stats SET guests_total = 3, confirmed = 1, declined = 1, pending = 1
           WHERE wedding_id = $1`,
          [weddingId],
        );
        const { rows } = await api.query<{ rsvp_percent: string }>(
          `SELECT rsvp_percent FROM wedding_stats WHERE wedding_id = $1`,
          [weddingId],
        );
        expect(rows[0].rsvp_percent).toBe('66.67');
      });
    });

    it('RN16 - a API não cria nem apaga a linha, e quem não tem vínculo não a vê', async () => {
      await as(ana, async () => {
        await expect(
          api.query(`DELETE FROM wedding_stats WHERE wedding_id = $1`, [weddingId]),
        ).rejects.toThrow(/permission denied/);
      });
      await as(estranha, async () => {
        const { rowCount } = await api.query(`SELECT 1 FROM wedding_stats WHERE wedding_id = $1`, [
          weddingId,
        ]);
        expect(rowCount).toBe(0);
      });
    });
  });
});
