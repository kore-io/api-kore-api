import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedReferrerWedding, seedWedding } from '../support/weddings';

/**
 * Casais que vieram pelo link de indicação (Link de indicação RN03 a RN05),
 * com o banco real: a função referred_weddings(), SECURITY DEFINER sem
 * parâmetro de id, e os testes de isolamento da RN04 (decisão 224, mapa das
 * leituras fora da RLS por casamento).
 */
describe('Link de indicação: os casais do link (banco real; RN03 a RN05)', () => {
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

  const list = (cookie: string) =>
    request(app.getHttpServer()).get('/v1/me/referrer/weddings').set('Cookie', cookie);

  async function planner(name = 'Juliana Prado') {
    const { userId } = await seedReferrer({ db, kind: 'planner', name });
    const cookie = await openSession({ app, userId });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId } });
    return { userId, cookie, referrerId: referrer.id };
  }

  /** O casamento do casal que se cadastrou pelo link de quem indicou. */
  async function viaLink({
    referrerId,
    collaboratorIds = [],
    createdAt,
    source = 'referral_link',
  }: {
    referrerId: string;
    collaboratorIds?: string[];
    createdAt: Date;
    source?: 'referral_link' | 'admin_reassigned';
  }) {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId, collaboratorIds });
    await db.wedding.update({
      where: { id: weddingId },
      data: { referrerId, referralSource: source, createdAt, signupSource: 'referral_link' },
    });
    return weddingId;
  }

  it('RN03 a RN05 - só os do link dela, do mais recente para o mais antigo; clicável só onde colabora, e sem o id quando não', async () => {
    const juliana = await planner();
    const older = await viaLink({
      referrerId: juliana.referrerId,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    });
    const newer = await viaLink({
      referrerId: juliana.referrerId,
      collaboratorIds: [juliana.userId],
      createdAt: new Date('2026-11-01T00:00:00Z'),
    });
    // Fora da lista:
    await seedReferrerWedding({ db, referrerUserId: juliana.userId }); // created_by_planner
    const clara = await planner('Clara Dias');
    await viaLink({ referrerId: clara.referrerId, createdAt: new Date() }); // link de outra
    await viaLink({
      referrerId: juliana.referrerId,
      createdAt: new Date(),
      source: 'admin_reassigned',
    }); // reatribuído (F3)
    const purged = await viaLink({ referrerId: juliana.referrerId, createdAt: new Date() });
    await db.wedding.update({
      where: { id: purged },
      data: { status: 'purged', purgedAt: new Date() },
    });

    const response = await list(juliana.cookie).expect(200);

    expect(response.body).toEqual([
      {
        weddingId: newer,
        partnerNames: ['Ana', 'Marcos'],
        status: 'draft',
        createdAt: '2026-11-01T00:00:00.000Z',
        clickable: true,
        // Comissões RN08: sem pagamento, "—".
        commission: null,
      },
      {
        weddingId: null,
        partnerNames: ['Ana', 'Marcos'],
        status: 'draft',
        createdAt: '2026-10-01T00:00:00.000Z',
        clickable: false,
        commission: null,
      },
    ]);
    // Nada além de nomes e status sai: sem endereço, data, cidade nem contato.
    expect(JSON.stringify(response.body)).not.toContain(older);
  });

  it('decisão 224(3) - sem o perfil de cerimonialista: 403 PROFILE_NOT_OWNED', async () => {
    const ana = await signedInUser({ app });
    const seller = await seedReferrer({ db, kind: 'seller', name: 'Lucas Andrade' });

    expect((await list(ana.cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
    const cookie = await openSession({ app, userId: seller.userId });
    expect((await list(cookie).expect(403)).body.error).toBe('PROFILE_NOT_OWNED');
  });

  it('RN04 - a função, com o kore_api, sem app.user_id devolve vazio; com outra pessoa, só os dela', async () => {
    const juliana = await planner();
    await viaLink({ referrerId: juliana.referrerId, createdAt: new Date() });
    const clara = await planner('Clara Dias');

    await api.query('BEGIN');
    try {
      expect((await api.query('SELECT * FROM referred_weddings()')).rowCount).toBe(0);
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [clara.userId]);
      expect((await api.query('SELECT * FROM referred_weddings()')).rowCount).toBe(0);
      await api.query(`SELECT set_config('app.user_id', $1, true)`, [juliana.userId]);
      expect((await api.query('SELECT * FROM referred_weddings()')).rowCount).toBe(1);
    } finally {
      await api.query('ROLLBACK');
    }
  });
});
