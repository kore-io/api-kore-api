import { INestApplication } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import {
  ADMIN_INSIGHTS_READER,
  type AdminInsightsReader,
} from '@/modules/backoffice/application/ports/admin-insights.reader.port';
import { localDate } from '@/shared/kernel/time/local-date';
import { PrismaAdminInsightsReader } from '@/modules/backoffice/infrastructure/backoffice/prisma-admin-insights.reader';
import { createTestApp } from '../support/harness/create-test-app';
import { devPaymentEvent, expectStatus, payForPublication } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { signedInUser, staffUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

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
    // O % e o _ valem como letra: não listam os 10 mais recentes (sugestão do Crivo, 11b).
    for (const q of ['%%', '__']) {
      const wild = (await get(support.cookie, '/search', { q }).expect(200)).body as {
        weddings: unknown[];
        referrers: unknown[];
      };
      expect([wild.weddings.length, wild.referrers.length]).toEqual([0, 0]);
    }
  });

  it('RN04 - os valores da Visão geral: o mês em Brasília, a Ativação, e a Receita sem os juros do cartão e só com o pagamento aplicado no mês (pelo appliedAt, não pelo paidAt)', async () => {
    // Um mês antigo e sorteado: o kore_test é compartilhado, então o caso mede
    // a diferença antes e depois das próprias linhas (pelo reader, sem o cache).
    const year = 1980 + randomInt(30);
    // De maio a setembro: o antigo horário de verão de Brasília não chega lá (-03 o mês todo).
    const month = String(5 + randomInt(5)).padStart(2, '0');
    const monthStart = new Date(`${year}-${month}-01T03:00:00.000Z`); // 00:00 em Brasília
    const midMonth = new Date(`${year}-${month}-15T15:00:00.000Z`);
    const reader = app.get<AdminInsightsReader>(ADMIN_INSIGHTS_READER);
    const before = await reader.overview({ role: 'admin', now: midMonth });
    expect(before.month).toBe(`${year}-${month}`);

    const ana = await signedInUser({ app });
    // No primeiro minuto do mês em Brasília: conta. Um milissegundo antes: é do mês anterior.
    const inside = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({ where: { id: inside.weddingId }, data: { createdAt: monthStart } });
    const outside = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: outside.weddingId },
      data: { createdAt: new Date(monthStart.getTime() - 1) },
    });
    // Publicado no cartão em 12x (com juros) e aplicado no meio do mês.
    const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
    const eventDate = addMonths({ day: today, months: 2 });
    const paid = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: paid.weddingId },
      data: { eventDate: new Date(`${eventDate}T00:00:00Z`) },
    });
    const created = expectStatus(
      await payForPublication({
        app,
        cookie: ana.cookie,
        weddingId: paid.weddingId,
        endDate: addMonths({ day: eventDate, months: 3 }),
        installments: 12,
      }),
      201,
    );
    const paymentId = created.body.paymentId as string;
    expectStatus(await devPaymentEvent({ app, paymentId, event: 'confirm' }), 200);
    await db.wedding.update({
      where: { id: paid.weddingId },
      data: { createdAt: midMonth, publishedAt: midMonth },
    });
    // Pago no mês anterior e aplicado neste: a Receita conta pelo appliedAt.
    const payment = await db.payment.update({
      where: { id: paymentId },
      data: { paidAt: new Date(monthStart.getTime() - 5 * DAY_MS), appliedAt: midMonth },
    });
    expect(payment.installmentInterestCents).toBeGreaterThan(0);
    // Pago neste mês e não aplicado (sem destino): fica fora da Receita.
    const orphan = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: orphan.weddingId },
      data: { eventDate: new Date(`${eventDate}T00:00:00Z`) },
    });
    const orphanPayment = expectStatus(
      await payForPublication({
        app,
        cookie: ana.cookie,
        weddingId: orphan.weddingId,
        endDate: addMonths({ day: eventDate, months: 3 }),
      }),
      201,
    ).body.paymentId as string;
    expectStatus(await devPaymentEvent({ app, paymentId: orphanPayment, event: 'confirm' }), 200);
    await db.wedding.update({
      where: { id: orphan.weddingId },
      data: {
        status: 'draft',
        endDate: null,
        paidThrough: null,
        publicationSource: null,
        publishedAt: null,
        createdAt: new Date(monthStart.getTime() - 40 * DAY_MS),
      },
    });
    await db.commission.deleteMany({ where: { paymentId: orphanPayment } });
    await db.payment.update({
      where: { id: orphanPayment },
      data: { paidAt: midMonth, appliedAt: null },
    });

    const after = await reader.overview({ role: 'admin', now: midMonth });
    // Os números do mês contam do início dele em diante (o "agora" de verdade é
    // o mês corrente): com o mês antigo, entram as linhas que as outras suítes
    // gravam em paralelo. O gráfico é o mês fechado: é por ele que se mede.
    const point = (
      overview: typeof after,
      chart: 'created' | 'published' | 'revenueCents',
      at: number,
    ) => overview.charts[chart]!.at(at)!.value;
    expect(point(after, 'created', -1) - point(before, 'created', -1)).toBe(2);
    // O de um milissegundo antes ficou no mês anterior.
    expect(point(after, 'created', -2) - point(before, 'created', -2)).toBe(1);
    expect(point(after, 'published', -1) - point(before, 'published', -1)).toBe(1);
    // A Receita sem os juros do cartão.
    expect(point(after, 'revenueCents', -1) - point(before, 'revenueCents', -1)).toBe(
      payment.amountCents - payment.installmentInterestCents,
    );
    // Nem o mês do paidAt do aplicado nem o não aplicado mudam a Receita.
    expect(point(after, 'revenueCents', -2) - point(before, 'revenueCents', -2)).toBe(0);
    expect(
      after.revenue!.publicationsCents - before.revenue!.publicationsCents,
    ).toBeGreaterThanOrEqual(payment.amountCents - payment.installmentInterestCents);
    // A Ativação é publicados sobre criados do mês, com uma casa.
    expect(after.activationPercent).toBe(
      Math.round((after.weddingsPublished / after.weddingsCreated) * 1000) / 10,
    );
  });

  it('RN04 - a taxa de resposta média: só os casamentos no ar (publicado, pós-evento e carência), com convidados e não bloqueados, com uma casa', async () => {
    // O kore_test é compartilhado e a média é de todos os casamentos: o caso roda
    // o reader numa transação que esconde as tabelas reais atrás de tabelas
    // temporárias (o pg_temp vem antes do public na busca) e desfaz tudo no fim.
    const rollback = new Error('rollback');
    let average: number | null | undefined;
    await db
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE weddings (id uuid, status wedding_status, blocked_at timestamptz,
             created_at timestamptz, published_at timestamptz) ON COMMIT DROP`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TEMP TABLE wedding_stats (wedding_id uuid, guests_total int,
             rsvp_percent numeric(5,2)) ON COMMIT DROP`,
        );
        const rows: [string, string | null, number, string][] = [
          ['published', null, 10, '80.00'],
          ['post_event', null, 10, '60.00'],
          ['grace', null, 10, '33.33'],
          // Fora da média: bloqueado, sem convidados, rascunho e expirado.
          ['published', '2026-01-01T00:00:00Z', 10, '100.00'],
          ['published', null, 0, '0.00'],
          ['draft', null, 10, '100.00'],
          ['expired', null, 10, '100.00'],
        ];
        for (const [status, blockedAt, guests, percent] of rows) {
          const id = randomUUID();
          await tx.$executeRawUnsafe(
            `INSERT INTO weddings (id, status, blocked_at) VALUES ($1::uuid, $2::wedding_status, $3::timestamptz)`,
            id,
            status,
            blockedAt,
          );
          await tx.$executeRawUnsafe(
            `INSERT INTO wedding_stats VALUES ($1::uuid, $2, $3::numeric)`,
            id,
            guests,
            percent,
          );
        }
        const reader = new PrismaAdminInsightsReader(tx as unknown as BackofficePrismaService);
        average = (await reader.overview({ role: 'support', now: new Date() })).rsvpAveragePercent;
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    // (80 + 60 + 33,33) / 3 = 57,776…
    expect(average).toBe(57.8);
  });

  it('RN11 - o Log da aplicação filtra por casamento e ação e fica nos últimos 30 dias sem período', async () => {
    const admin = await staffUser({ app, role: 'admin' });
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

    const withPeriod = await get(admin.cookie, '/logs', {
      weddingId,
      from: new Date(Date.now() - 60 * DAY_MS).toISOString(),
    }).expect(200);
    expect(withPeriod.body.total).toBe(2);
  });

  it('RN11 (decisão 316(11)(c)) - cada linha traz o nome e o papel de quem agiu e o casal', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support', name: 'Bruno Tavares' });
    const ana = await signedInUser({ app, name: 'Ana Beatriz Moreira' });
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    const at = (seconds: number) => new Date(Date.now() - seconds * 1000);
    await db.applicationLog.createMany({
      data: [
        {
          action: 'wedding.blocked',
          actorKind: 'admin',
          actorUserId: support.userId,
          weddingId,
          createdAt: at(5),
        },
        {
          action: 'guest.created',
          actorKind: 'user',
          actorUserId: ana.userId,
          weddingId,
          createdAt: at(4),
        },
        {
          action: 'guest.updated',
          actorKind: 'user',
          actorUserId: juliana.userId,
          weddingId,
          createdAt: at(3),
        },
        // Sem casamento: o papel é o do indicador.
        {
          action: 'pix_key.changed',
          actorKind: 'user',
          actorUserId: juliana.userId,
          createdAt: at(2),
        },
        { action: 'wedding.expired', actorKind: 'system', weddingId, createdAt: at(1) },
      ],
    });

    const byWedding = await get(admin.cookie, '/logs', { weddingId }).expect(200);
    const rows = (
      byWedding.body.items as { action: string; actor: unknown; coupleNames: string | null }[]
    ).map(({ action, actor, coupleNames }) => ({ action, actor, coupleNames }));
    expect(rows).toEqual([
      { action: 'wedding.expired', actor: null, coupleNames: 'Ana & Marcos' },
      {
        action: 'guest.updated',
        actor: { name: 'Juliana Prado', role: 'collaborator' },
        coupleNames: 'Ana & Marcos',
      },
      {
        action: 'guest.created',
        actor: { name: 'Ana Beatriz Moreira', role: 'owner' },
        coupleNames: 'Ana & Marcos',
      },
      {
        action: 'wedding.blocked',
        actor: { name: 'Bruno Tavares', role: 'support' },
        coupleNames: 'Ana & Marcos',
      },
    ]);
    // Decisão 320(2): a aba Log do detalhe do casamento traz o mesmo actor.
    const tab = await get(admin.cookie, `/weddings/${weddingId}`, { tab: 'log' }).expect(200);
    const tabRows = (tab.body.log.items as { action: string; actor: unknown }[])
      .filter((item) => !item.action.startsWith('admin.'))
      .map(({ action, actor }) => ({ action, actor }));
    expect(tabRows).toEqual(rows.map(({ action, actor }) => ({ action, actor })));

    const byUser = await get(admin.cookie, '/logs', {
      userId: juliana.userId,
      action: 'pix_key.changed',
    }).expect(200);
    expect(byUser.body.items).toEqual([
      expect.objectContaining({
        actor: { name: 'Juliana Prado', role: 'planner' },
        coupleNames: null,
      }),
    ]);
  });

  it('RN02 e RN11 (decisões 69 e 275) - o suporte não lê dinheiro no log: sem as ações de Cobrança, Repasses, chave Pix e Configurações, e sem centavos em nenhum nível do JSON', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    const nested = {
      reason: 'Ajuste combinado',
      amountCents: 1500,
      detail: { totalCentsBefore: 3000, items: [{ valueCents: 10, label: 'a' }] },
    };
    await db.applicationLog.createMany({
      data: [
        { action: 'commission.adjusted', actorKind: 'system', weddingId, data: nested },
        {
          action: 'payout.released',
          actorKind: 'system',
          weddingId,
          data: { amountCentsBefore: 5000, amountCentsAfter: 4000 },
        },
        {
          action: 'settings.referral_updated',
          actorKind: 'system',
          weddingId,
          data: { before: { payoutMinCents: 5000 }, after: { payoutMinCents: 6000 } },
        },
        { action: 'payment.refunded', actorKind: 'system', weddingId, data: { kind: 'x' } },
        { action: 'payments.exported', actorKind: 'system', weddingId, data: {} },
        { action: 'pix_key.changed', actorKind: 'system', weddingId, data: {} },
        { action: 'integration.tested', actorKind: 'system', weddingId, data: {} },
      ],
    });

    const asAdmin = await get(admin.cookie, '/logs', { weddingId }).expect(200);
    const adminPage = asAdmin.body as { total: number; items: { action: string; data: unknown }[] };
    expect(adminPage.total).toBe(7);
    const adminAdjusted = adminPage.items.find((item) => item.action === 'commission.adjusted');
    expect(adminAdjusted?.data).toEqual(nested);

    for (const path of ['/logs', `/weddings/${weddingId}`]) {
      const res = await get(
        support.cookie,
        path,
        path === '/logs' ? { weddingId } : { tab: 'log' },
      ).expect(200);
      const page = (path === '/logs' ? res.body : res.body.log) as {
        total: number;
        items: { action: string; data: unknown }[];
      };
      // A leitura da aba grava a própria linha (admin.wedding_viewed), que não é de dinheiro.
      const own = page.items.filter((item) => !item.action.startsWith('admin.'));
      expect(own.map((item) => item.action)).toEqual(['commission.adjusted']);
      expect(own[0].data).toEqual({
        reason: 'Ajuste combinado',
        detail: { items: [{ label: 'a' }] },
      });
      expect(JSON.stringify(page.items).toLowerCase()).not.toContain('cents');
    }
    const filtered = await get(support.cookie, '/logs', {
      weddingId,
      action: 'payout.released',
    }).expect(200);
    expect(filtered.body.total).toBe(0);
  });

  it('RN02 e RN11 (decisão 275, regressão do DoD) - o suporte não lê nenhum valor do payout.released nem do settings.referral_updated, com os valores aninhados', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const weddingId = randomUUID();
    // Os formatos que o código grava (prisma-payout-admin.store e admin-settings.use-cases).
    const settingsBefore = {
      defaultRatePercent: 20,
      referralDiscountPercent: 10,
      commissionHoldDays: 30,
      payoutMinCents: 5123,
    };
    const settingsAfter = { ...settingsBefore, payoutMinCents: 6123 };
    await db.applicationLog.createMany({
      data: [
        {
          action: 'payout.released',
          actorKind: 'system',
          weddingId,
          entityType: 'payout',
          entityId: randomUUID(),
          data: { amountCentsBefore: 5123, amountCentsAfter: 4123 },
        },
        {
          action: 'settings.referral_updated',
          actorKind: 'system',
          weddingId,
          data: {
            before: settingsBefore,
            after: settingsAfter,
            changes: { payoutMinCents: { from: 5123, to: 6123 } },
            plannersUpdated: 0,
          },
        },
      ],
    });

    const asAdmin = await get(admin.cookie, '/logs', { weddingId }).expect(200);
    expect(JSON.stringify(asAdmin.body.items)).toContain('6123');

    for (const action of [undefined, 'payout.released', 'settings.referral_updated']) {
      const asSupport = await get(support.cookie, '/logs', {
        weddingId,
        ...(action ? { action } : {}),
      }).expect(200);
      const body = JSON.stringify(asSupport.body.items);
      for (const value of ['5123', '4123', '6123', 'Cents', 'cents'])
        expect(body).not.toContain(value);
    }
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
