import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedInvitation } from '../support/invitations';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';
const SITE_ORIGIN = 'http://localhost:5174';

/**
 * Assinatura do cerimonialista no site (F6, C7), com o banco real: uma regra
 * só (wedding_planner_credit) nas quatro leituras (site público, prévia,
 * convite do casal e Editor), o Switch do casal, a ocultação pelo Kore e o
 * predicado do nome igual no domínio e no banco.
 */
describe('Assinatura do cerimonialista no site (banco real; decisões 223 e 224)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const site = (slug: string, cookie?: string) => {
    const call = http().get(`/v1/sites/${slug}`).set('Origin', SITE_ORIGIN);
    return cookie ? call.set('Cookie', cookie) : call;
  };
  const editor = (cookie: string, weddingId: string) =>
    http().get(`/v1/weddings/${weddingId}/site`).set('Cookie', cookie);
  const patchSite = (cookie: string, weddingId: string, body: object) =>
    http()
      .patch(`/v1/weddings/${weddingId}/site`)
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .send(body);

  /** Ana e Marcos, publicado, com Juliana (Prado Assessoria) colaboradora. */
  async function publishedWedding({
    creditName = 'Prado Assessoria',
    kind = 'planner',
  }: { creditName?: string; kind?: 'planner' | 'seller' } = {}) {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const juliana = await seedReferrer({ db, kind, name: creditName });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const wedding = await db.wedding.update({
      where: { id: weddingId },
      data: { status: 'published', publishedAt: new Date(), eventDate: new Date('2027-03-20') },
    });
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    return { ana, juliana, julianaCookie, weddingId, slug: wedding.slug ?? '' };
  }

  const creditOf = async (slug: string): Promise<{ name: string } | null> =>
    ((await site(slug).expect(200)).body as { plannerCredit: { name: string } | null })
      .plannerCredit;

  it('RN01 e RN02 - a assinatura aparece no site para o visitante, e o Editor traz o Switch', async () => {
    const { ana, weddingId, slug } = await publishedWedding();

    expect(await creditOf(slug)).toEqual({ name: 'Prado Assessoria' });
    expect((await editor(ana.cookie, weddingId).expect(200)).body.plannerCredit).toEqual({
      name: 'Prado Assessoria',
      showPlannerCredit: true,
      hiddenByKore: false,
      canChange: true,
    });
  });

  it('RN02 - sem colaboradora (casal que veio pelo link), sem assinatura e sem Switch', async () => {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Prado Assessoria' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const wedding = await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });

    expect(await creditOf(wedding.slug ?? '')).toBeNull();
    expect((await editor(ana.cookie, weddingId).expect(200)).body.plannerCredit).toBeNull();
  });

  it('RN02 - o vendedor colaborador não assina', async () => {
    const { slug } = await publishedWedding({ kind: 'seller', creditName: 'Lucas Andrade' });

    expect(await creditOf(slug)).toBeNull();
  });

  it('RN02 - Referrer inativo ou conta bloqueada: sem assinatura', async () => {
    const inactive = await publishedWedding();
    await db.referrer.update({
      where: { userId: inactive.juliana.userId },
      data: { status: 'inactive' },
    });
    const blocked = await publishedWedding();
    await db.user.update({ where: { id: blocked.juliana.userId }, data: { status: 'blocked' } });

    expect(await creditOf(inactive.slug)).toBeNull();
    expect(await creditOf(blocked.slug)).toBeNull();
  });

  it('RN02 e RN07 - a colaboração acaba e a assinatura some no carregamento seguinte', async () => {
    const { ana, juliana, weddingId, slug } = await publishedWedding();
    const membership = await db.membership.findFirstOrThrow({
      where: { weddingId, userId: juliana.userId },
    });

    await http()
      .delete(`/v1/weddings/${weddingId}/memberships/${membership.id}`)
      .set('Cookie', ana.cookie)
      .set('Origin', APP_ORIGIN)
      .expect(204);

    const response = await site(slug).expect(200);
    expect(response.body.plannerCredit).toBeNull();
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('RN03 - o nome que não passa no predicado não aparece, e o perfil fica incompleto', async () => {
    const { ana, julianaCookie, weddingId, slug } = await publishedWedding({
      creditName: 'Juliana 11 9 9999-9999',
    });

    expect(await creditOf(slug)).toBeNull();
    expect((await editor(ana.cookie, weddingId).expect(200)).body.plannerCredit).toMatchObject({
      name: null,
    });
    expect(
      (await http().get('/v1/me/planner').set('Cookie', julianaCookie).expect(200)).body
        .profileComplete,
    ).toBe(false);
  });

  it('RN05 - o casal oculta, com log; a colaboradora não muda (403 com o campo), e o valor igual não é erro', async () => {
    const { ana, julianaCookie, weddingId, slug } = await publishedWedding();

    const refused = await patchSite(julianaCookie, weddingId, { showPlannerCredit: false }).expect(
      403,
    );
    expect(refused.body).toMatchObject({
      error: 'FIELD_NOT_ALLOWED',
      fields: ['showPlannerCredit'],
    });
    await patchSite(julianaCookie, weddingId, { showPlannerCredit: true }).expect(200);
    expect((await editor(julianaCookie, weddingId).expect(200)).body.plannerCredit.canChange).toBe(
      false,
    );

    await patchSite(ana.cookie, weddingId, { showPlannerCredit: false }).expect(200);

    expect(await creditOf(slug)).toBeNull();
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.planner_credit_changed', weddingId },
    });
    expect(log.data).toEqual({ show: false });
    expect((await editor(ana.cookie, weddingId).expect(200)).body.plannerCredit).toMatchObject({
      name: 'Prado Assessoria',
      showPlannerCredit: false,
    });
    // Null não é "não muda": 400.
    await patchSite(ana.cookie, weddingId, { showPlannerCredit: null }).expect(400);
  });

  it('RN05 - o PATCH aceita o campo mesmo sem colaboradora (preferência do casamento)', async () => {
    const ana = await signedInUser({ app, name: 'Ana Beatriz' });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });

    await patchSite(ana.cookie, weddingId, { showPlannerCredit: false }).expect(200);

    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).showPlannerCredit,
    ).toBe(false);
  });

  it('RN06 - ocultada pelo Kore: nenhum site mostra, o Editor e o Meu perfil sabem, e o motivo não sai', async () => {
    const { ana, julianaCookie, juliana, weddingId, slug } = await publishedWedding();
    await db.planner.updateMany({
      where: { referrer: { userId: juliana.userId } },
      data: { creditHiddenAt: new Date(), creditHiddenReason: 'propaganda no nome' },
    });

    expect(await creditOf(slug)).toBeNull();
    const view = await editor(ana.cookie, weddingId).expect(200);
    expect(view.body.plannerCredit).toMatchObject({ hiddenByKore: true });
    const profile = await http().get('/v1/me/planner').set('Cookie', julianaCookie).expect(200);
    expect(profile.body.creditHidden).toBe(true);
    expect(JSON.stringify([view.body, profile.body])).not.toContain('propaganda');
  });

  it('RN02 e RN04 - a mesma regra nas quatro leituras: site público, prévia, convite do casal e Editor', async () => {
    const cases: {
      label: string;
      setup: (w: Awaited<ReturnType<typeof publishedWedding>>) => Promise<void>;
    }[] = [
      { label: 'com tudo', setup: () => Promise.resolve() },
      {
        label: 'oculta pelo casal',
        setup: async (w) => {
          await db.wedding.update({
            where: { id: w.weddingId },
            data: { showPlannerCredit: false },
          });
        },
      },
      {
        label: 'oculta pelo Kore',
        setup: async (w) => {
          await db.planner.updateMany({
            where: { referrer: { userId: w.juliana.userId } },
            data: { creditHiddenAt: new Date() },
          });
        },
      },
      {
        label: 'nome que não passa no predicado',
        setup: async (w) => {
          await db.planner.updateMany({
            where: { referrer: { userId: w.juliana.userId } },
            data: { creditName: 'Prado www.prado.com.br' },
          });
        },
      },
      {
        label: 'colaboração encerrada',
        setup: async (w) => {
          await db.membership.updateMany({
            where: { weddingId: w.weddingId, userId: w.juliana.userId },
            data: { removedAt: new Date() },
          });
        },
      },
    ];
    for (const { label, setup } of cases) {
      const w = await publishedWedding();
      await setup(w);
      const { token } = await seedInvitation({
        db,
        weddingId: w.weddingId,
        kind: 'couple',
        email: null,
        invitedByUserId: w.ana.userId,
      });
      const preview = (
        await http()
          .post(`/v1/weddings/${w.weddingId}/site-previews`)
          .set('Cookie', w.ana.cookie)
          .set('Origin', APP_ORIGIN)
          .send({ mode: 'visitor' })
          .expect(201)
      ).body as { url: string };
      const exchanged = await http()
        .post(`/v1/sites/${w.slug}/preview-session`)
        .set('Origin', SITE_ORIGIN)
        .send({ token: new URL(preview.url).searchParams.get('previa') })
        .expect(200);
      const previewCookie = String(exchanged.headers['set-cookie']).split(';')[0];

      const publicName = (await creditOf(w.slug))?.name ?? null;
      const previewName =
        (await site(w.slug, previewCookie).expect(200)).body.plannerCredit?.name ?? null;
      const invitationName =
        (await http().get(`/v1/access-invitations/${token}`).expect(200)).body.plannerCredit
          ?.name ?? null;
      const credit = (await editor(w.ana.cookie, w.weddingId).expect(200)).body.plannerCredit;
      const editorName =
        credit && credit.showPlannerCredit && !credit.hiddenByKore ? credit.name : null;

      const expected = label === 'com tudo' ? 'Prado Assessoria' : null;
      expect({ label, publicName, previewName, invitationName, editorName }).toEqual({
        label,
        publicName: expected,
        previewName: expected,
        invitationName: expected,
        editorName: expected,
      });
    }
  });

  it('segurança - o kore_app não chama as funções com um id qualquer; as da sessão só respondem no casamento da transação, com vínculo', async () => {
    const { ana, juliana, weddingId } = await publishedWedding();
    const stranger = await signedInUser({ app });
    const api = new Client({ connectionString: process.env.DATABASE_URL });
    await api.connect();
    const as = async (userId: string, work: () => Promise<void>) => {
      await api.query('BEGIN');
      try {
        await api.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
        await api.query(`SELECT set_config('app.wedding_id', $1, true)`, [weddingId]);
        await work();
      } finally {
        await api.query('ROLLBACK');
      }
    };
    try {
      await as(stranger.userId, async () => {
        for (const fn of ['wedding_planner_credit', 'wedding_planner_collaborator']) {
          await api.query('SAVEPOINT s');
          await expect(api.query(`SELECT * FROM ${fn}($1::uuid)`, [weddingId])).rejects.toThrow(
            /permission denied/,
          );
          await api.query('ROLLBACK TO SAVEPOINT s');
        }
        expect(
          (await api.query('SELECT session_wedding_planner_credit() AS name')).rows[0].name,
        ).toBeNull();
        expect(
          (await api.query('SELECT * FROM session_wedding_planner_collaborator()')).rowCount,
        ).toBe(0);
      });
      for (const userId of [ana.userId, juliana.userId])
        await as(userId, async () => {
          expect(
            (await api.query('SELECT session_wedding_planner_credit() AS name')).rows[0].name,
          ).toBe('Prado Assessoria');
          expect(
            (await api.query('SELECT * FROM session_wedding_planner_collaborator()')).rowCount,
          ).toBe(1);
        });
    } finally {
      await api.end();
    }
  });
});
