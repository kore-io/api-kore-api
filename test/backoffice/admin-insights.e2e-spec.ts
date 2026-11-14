import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { createTestApp } from '../support/create-test-app';
import { seedReferrer } from '../support/referrers';
import { signedInUser, staffUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const DAY_MS = 86_400_000;

/**
 * Backoffice: Visão geral, busca, log e alertas (Backoffice - acesso RN02,
 * RN03, RN04, RN11 e RN12). O kore_test é compartilhado: cada caso procura as
 * próprias linhas.
 */
describe('Backoffice: visão geral, busca, log e alertas (Backoffice - acesso RN02 a RN04, RN11 e RN12; banco real)', () => {
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
  const get = (cookie: string, path: string, query: Record<string, string> = {}) =>
    http().get(`/v1/admin${path}`).query(query).set('Cookie', cookie);
  const post = (cookie: string, path: string) =>
    http().post(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send({});

  it('RN04 e RN02 - a Visão geral: o Admin recebe a receita, os repasses pedidos e o gráfico da receita; o suporte não recebe esses campos', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });

    const asAdmin = await get(admin.cookie, '/overview').expect(200);
    expect(asAdmin.body).toMatchObject({
      month: expect.stringMatching(/^\d{4}-\d{2}$/),
      weddingsCreated: expect.any(Number),
      weddingsPublished: expect.any(Number),
      plannersActive: expect.any(Number),
      plannersNew: expect.any(Number),
      openAlerts: expect.any(Number),
      revenue: { publicationsCents: expect.any(Number), extensionsCents: expect.any(Number) },
      payoutsRequested: { count: expect.any(Number), amountCents: expect.any(Number) },
    });
    for (const chart of ['created', 'published', 'revenueCents'])
      expect(asAdmin.body.charts[chart]).toHaveLength(12);
    const created = asAdmin.body.charts.created as { month: string }[];
    expect(created[created.length - 1].month).toBe(asAdmin.body.month);

    const asSupport = await get(support.cookie, '/overview').expect(200);
    expect(asSupport.body).not.toHaveProperty('revenue');
    expect(asSupport.body).not.toHaveProperty('payoutsRequested');
    expect(asSupport.body.charts).not.toHaveProperty('revenueCents');
    expect(asSupport.body.charts.created).toHaveLength(12);
  });

  it('RN03 - a busca acha o casamento pelo slug, pelo nome e pelo e-mail, e o indicador pelo código; o termo vai ao log só em hash', async () => {
    const support = await staffUser({ app, role: 'support' });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const token = randomUUID().slice(0, 8);
    await db.wedding.update({ where: { id: weddingId }, data: { slug: `moreira-${token}` } });
    await db.partner.updateMany({
      where: { weddingId, slot: 2 },
      data: { displayName: `Marcos Moreira${token}` },
    });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });

    const found = async (q: string) =>
      (await get(support.cookie, '/search', { q }).expect(200)).body as {
        weddings: { id: string }[];
        referrers: { referralCode: string; kind: string; name: string }[];
      };
    expect((await found(`moreira-${token}`)).weddings.map((row) => row.id)).toEqual([weddingId]);
    expect((await found(`Moreira${token.toUpperCase()}`)).weddings.map((row) => row.id)).toEqual([
      weddingId,
    ]);
    expect((await found(ana.email)).weddings.map((row) => row.id)).toEqual([weddingId]);
    expect((await found(juliana.referralCode)).referrers).toEqual([
      expect.objectContaining({
        referralCode: juliana.referralCode,
        kind: 'planner',
        name: 'Juliana Prado',
      }),
    ]);

    const logs = await db.applicationLog.findMany({
      where: { action: 'admin.search', actorUserId: support.userId },
    });
    expect(logs).toHaveLength(4);
    for (const log of logs) {
      expect(log.data).toMatchObject({ termHash: expect.any(String) });
      expect(JSON.stringify(log.data)).not.toContain(token);
      expect(JSON.stringify(log.data)).not.toContain(ana.email);
    }
    await get(support.cookie, '/search', { q: 'a' }).expect(400);
  });

  it('RN11 - o Log da aplicação filtra por casamento e ação, fica nos últimos 30 dias sem período e tira os centavos do suporte', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const weddingId = randomUUID();
    await db.applicationLog.createMany({
      data: [
        {
          action: 'payment.refund_requested',
          actorKind: 'system',
          weddingId,
          data: { amountCents: 33710, kind: 'publication' },
        },
        {
          action: 'payment.refund_requested',
          actorKind: 'system',
          weddingId,
          createdAt: new Date(Date.now() - 40 * DAY_MS),
          data: { amountCents: 100 },
        },
      ],
    });

    const asAdmin = await get(admin.cookie, '/logs', {
      weddingId,
      action: 'payment.refund_requested',
    }).expect(200);
    expect(asAdmin.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(asAdmin.body.items[0].data).toEqual({ amountCents: 33710, kind: 'publication' });

    const asSupport = await get(support.cookie, '/logs', { weddingId }).expect(200);
    expect(asSupport.body.items[0].data).toEqual({ kind: 'publication' });

    const withPeriod = await get(admin.cookie, '/logs', {
      weddingId,
      from: new Date(Date.now() - 60 * DAY_MS).toISOString(),
    }).expect(200);
    expect(withPeriod.body.total).toBe(2);
  });

  it('RN12 - os alertas de dinheiro só para o Admin; resolver grava quem resolveu e o log; o suporte não resolve o de dinheiro', async () => {
    const admin = await staffUser({ app, role: 'admin', name: 'Renata Lima' });
    const support = await staffUser({ app, role: 'support' });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const disputed = await db.alert.create({
      data: {
        type: 'payment_disputed',
        weddingId,
        entityType: 'payment',
        entityId: randomUUID(),
        data: { shortCode: 'P-0402' },
      },
    });
    const purge = await db.alert.create({
      data: {
        type: 'purge_failed',
        weddingId,
        entityType: 'wedding',
        entityId: weddingId,
        data: { error: 'RangeError' },
      },
    });

    const ids = async (cookie: string) =>
      ((await get(cookie, '/alerts').expect(200)).body.items as { id: string }[]).map(
        (item) => item.id,
      );
    const adminIds = await ids(admin.cookie);
    expect(adminIds).toEqual(expect.arrayContaining([disputed.id, purge.id]));
    const supportIds = await ids(support.cookie);
    expect(supportIds).toContain(purge.id);
    expect(supportIds).not.toContain(disputed.id);
    const asAdmin = await get(admin.cookie, '/alerts').expect(200);
    expect(asAdmin.body.openCount).toEqual(expect.any(Number));
    expect(
      (asAdmin.body.items as { id: string; coupleNames: string }[]).find(
        (item) => item.id === purge.id,
      ),
    ).toMatchObject({ coupleNames: 'Ana & Marcos', type: 'purge_failed', status: 'open' });

    expect(
      (await post(support.cookie, `/alerts/${disputed.id}/resolve`).expect(404)).body.error,
    ).toBe('ALERT_NOT_FOUND');
    await post(support.cookie, `/alerts/${purge.id}/resolve`).expect(200);
    expect((await post(support.cookie, `/alerts/${purge.id}/resolve`).expect(409)).body.error).toBe(
      'ALERT_ALREADY_RESOLVED',
    );
    await post(admin.cookie, `/alerts/${disputed.id}/resolve`).expect(200);
    expect(await db.alert.findUniqueOrThrow({ where: { id: disputed.id } })).toMatchObject({
      status: 'resolved',
      resolvedByUserId: admin.userId,
    });
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'alert.resolved', entityId: disputed.id, actorUserId: admin.userId },
    });
    const resolved = await get(admin.cookie, '/alerts', { status: 'resolved' }).expect(200);
    expect(
      (resolved.body.items as { id: string; resolvedByName: string }[]).find(
        (item) => item.id === disputed.id,
      ),
    ).toMatchObject({ resolvedByName: 'Renata Lima' });
  });
});
