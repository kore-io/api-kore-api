import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { publishByPayment } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser, staffUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/** Reatribuir o indicador (Backoffice - acesso RN07; decisão 80), pelo Admin. */
describe('Backoffice: reatribuir o indicador (Backoffice - acesso RN07; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 2 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  const put = (cookie: string, weddingId: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put(`/v1/admin/weddings/${weddingId}/referrer`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(body);

  async function planner(name: string, status: 'active' | 'blocked' = 'active') {
    const seeded = await seedReferrer({ db, kind: 'planner', name, status });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    return { ...seeded, referrerId: referrer.id };
  }

  /** "Paula & Diego" em rascunho, indicado por Juliana. */
  async function draftWedding(referrerId: string) {
    const paula = await signedInUser({ app, name: 'Paula Rocha' });
    const { weddingId } = await seedWedding({ db, ownerId: paula.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: { referrerId, referralSource: 'referral_link', eventDate: day(eventDate) },
    });
    return { paula, weddingId };
  }

  const reason = 'Indicação feita por engano.';

  it('RN07 - antes do pagamento, passa a Fabiana com origem admin_reassigned, log e aviso aos dois, sem revelar o novo ao antigo', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const juliana = await planner('Juliana Prado');
    const fabiana = await planner('Fabiana Soares');
    const { weddingId } = await draftWedding(juliana.referrerId);

    expect(
      (await put(admin.cookie, weddingId, { referrerId: fabiana.referrerId, reason }).expect(200))
        .body,
    ).toEqual({ status: 'reassigned' });
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      referrerId: fabiana.referrerId,
      referralSource: 'admin_reassigned',
    });
    const log = await db.applicationLog.findFirstOrThrow({
      where: { weddingId, action: 'wedding.referrer_reassigned' },
    });
    expect(log).toMatchObject({
      ipHash: expect.any(String),
      actorUserId: admin.userId,
      data: { fromReferrerId: juliana.referrerId, toReferrerId: fabiana.referrerId, reason },
    });
    const noticeOf = (userId: string) =>
      db.notification.findFirstOrThrow({
        where: { userId, weddingId, type: 'referrer_reassigned' },
      });
    expect((await noticeOf(juliana.userId)).payload).toEqual([
      { partnerNames: ['Ana', 'Marcos'], direction: 'lost' },
    ]);
    expect((await noticeOf(fabiana.userId)).payload).toEqual([
      { partnerNames: ['Ana', 'Marcos'], direction: 'gained' },
    ]);
    // O aviso aparece na central da cerimonialista.
    const cookie = await openSession({ app, userId: juliana.userId });
    const center = await request(app.getHttpServer())
      .get('/v1/me/notifications')
      .query({ scope: 'planner', type: 'referrer_reassigned' })
      .set('Cookie', cookie)
      .expect(200);
    expect(
      (center.body.items as { weddingId: string; type: string }[]).filter(
        (item) => item.weddingId === weddingId,
      ),
    ).toEqual([expect.objectContaining({ type: 'referrer_reassigned' })]);

    // Sem indicador: a origem fica nula (o log guarda a troca).
    await put(admin.cookie, weddingId, { referrerId: null, reason }).expect(200);
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      referrerId: null,
      referralSource: null,
    });
  });

  it('decisão 317 (d) e (e) - o novo indicador vê o casal na lista; o antigo, não, mas o aviso dele fica na central, no sino, no read-all e no filtro Comissão', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const juliana = await planner('Juliana Prado');
    const fabiana = await planner('Fabiana Soares');
    const { weddingId } = await draftWedding(juliana.referrerId);
    const julianaCookie = await openSession({ app, userId: juliana.userId });
    const fabianaCookie = await openSession({ app, userId: fabiana.userId });
    const http = () => request(app.getHttpServer());
    const referred = async (cookie: string) =>
      (
        (await http().get('/v1/me/referrer/weddings').set('Cookie', cookie).expect(200)).body as {
          partnerNames: string[];
        }[]
      ).length;
    const before = {
      juliana: await referred(julianaCookie),
      fabiana: await referred(fabianaCookie),
    };

    await put(admin.cookie, weddingId, { referrerId: fabiana.referrerId, reason }).expect(200);

    // (d) Link de indicação RN03 e RN04: o admin_reassigned entra na lista da nova, sai da antiga.
    expect(await referred(fabianaCookie)).toBe(before.fabiana + 1);
    expect(await referred(julianaCookie)).toBe(before.juliana - 1);

    // (e) O lost continua com a antiga, que já não indica o casamento.
    const central = (cookie: string, query: Record<string, string> = {}) =>
      http()
        .get('/v1/me/notifications')
        .query({ scope: 'planner', ...query })
        .set('Cookie', cookie)
        .expect(200);
    const mine = (body: { items: { weddingId: string; type: string; payload: unknown }[] }) =>
      body.items.filter((item) => item.weddingId === weddingId);
    expect(mine((await central(julianaCookie)).body)).toEqual([
      expect.objectContaining({
        type: 'referrer_reassigned',
        payload: [{ partnerNames: ['Ana', 'Marcos'], direction: 'lost' }],
        readAt: null,
      }),
    ]);
    // (a) O filtro Comissão agrupa o commission e o referrer_reassigned, nas duas direções.
    expect(mine((await central(julianaCookie, { type: 'commission' })).body)).toHaveLength(1);
    expect(mine((await central(fabianaCookie, { type: 'commission' })).body)).toEqual([
      expect.objectContaining({
        type: 'referrer_reassigned',
        payload: [{ partnerNames: ['Ana', 'Marcos'], direction: 'gained' }],
      }),
    ]);
    const unread = async () =>
      (
        await http()
          .get('/v1/me/notifications/unread-count')
          .query({ scope: 'planner' })
          .set('Cookie', julianaCookie)
          .expect(200)
      ).body.unreadCount as number;
    expect(await unread()).toBeGreaterThanOrEqual(1);
    await http()
      .post('/v1/me/notifications/read-all')
      .query({ scope: 'planner' })
      .set('Cookie', julianaCookie)
      .set('Origin', ORIGIN)
      .expect(204);
    expect(await unread()).toBe(0);
    expect(
      await db.notification.findFirstOrThrow({
        where: { userId: juliana.userId, weddingId, type: 'referrer_reassigned' },
      }),
    ).toMatchObject({ readAt: expect.any(Date) });
  });

  it('RN07 - depois da publicação paga: 409 ALREADY_PAID com a data; com pagamento pendente: 409 PAYMENT_PENDING', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const juliana = await planner('Juliana Prado');
    const fabiana = await planner('Fabiana Soares');
    const paid = await draftWedding(juliana.referrerId);
    await publishByPayment({ app, cookie: paid.paula.cookie, weddingId: paid.weddingId, endDate });
    const refused = await put(admin.cookie, paid.weddingId, {
      referrerId: fabiana.referrerId,
      reason,
    }).expect(409);
    expect(refused.body).toMatchObject({ error: 'ALREADY_PAID', paidAt: expect.any(String) });

    const pending = await draftWedding(juliana.referrerId);
    await publishByPayment({
      app,
      cookie: pending.paula.cookie,
      weddingId: pending.weddingId,
      endDate,
    });
    // O pagamento volta a pendente pelo banco (o Pix da publicação aguardando).
    await db.wedding.update({
      where: { id: pending.weddingId },
      data: {
        status: 'draft',
        publishedAt: null,
        publicationSource: null,
        endDate: null,
        paidThrough: null,
      },
    });
    await db.payment.updateMany({
      where: { weddingId: pending.weddingId },
      data: { status: 'pending', paidAt: null, appliedAt: null },
    });
    await db.commission.deleteMany({ where: { weddingId: pending.weddingId } });
    expect(
      (
        await put(admin.cookie, pending.weddingId, {
          referrerId: fabiana.referrerId,
          reason,
        }).expect(409)
      ).body.error,
    ).toBe('PAYMENT_PENDING');
    expect(
      (await db.wedding.findUniqueOrThrow({ where: { id: pending.weddingId } })).referrerId,
    ).toBe(juliana.referrerId);
  });

  it('RN07 e RN02 - o indicador inativo é recusado; o suporte não reatribui', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const juliana = await planner('Juliana Prado');
    const blocked = await planner('Bloqueada da Silva', 'blocked');
    const { weddingId } = await draftWedding(juliana.referrerId);
    expect(
      (await put(admin.cookie, weddingId, { referrerId: blocked.referrerId, reason }).expect(409))
        .body.error,
    ).toBe('REFERRER_NOT_ACTIVE');
    expect(
      (await put(support.cookie, weddingId, { referrerId: null, reason }).expect(403)).body.error,
    ).toBe('ACTION_NOT_ALLOWED');
    await put(admin.cookie, weddingId, { referrerId: null, reason: 'curto' }).expect(400);
  });

  it('RN07 (decisão 256(3)) - o indicador que é dono do casamento é recusado com 409 SELF_REFERRAL', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const juliana = await planner('Juliana Prado');
    const { paula, weddingId } = await draftWedding(juliana.referrerId);
    const paulaReferrer = await seedReferrer({ db, kind: 'planner', name: 'Paula Rocha' });
    // Paula vira indicadora e é dona do casamento.
    await db.referrer.update({
      where: { userId: paulaReferrer.userId },
      data: { userId: paula.userId },
    });
    const own = await db.referrer.findUniqueOrThrow({ where: { userId: paula.userId } });
    expect(
      (await put(admin.cookie, weddingId, { referrerId: own.id, reason }).expect(409)).body.error,
    ).toBe('SELF_REFERRAL');
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).referrerId).toBe(
      juliana.referrerId,
    );
  });
});
