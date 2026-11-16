import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { BackofficeTransaction } from '@/shared/database/backoffice-transaction';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { ADMIN_SETTINGS_STORE } from '@/modules/backoffice/application/ports/admin-settings.store.port';
import type { AdminSettingsStore } from '@/modules/backoffice/application/ports/admin-settings.store.port';
import { createTestApp } from '../support/harness/create-test-app';
import { seedReferrer } from '../support/factories/referrers';
import { staffUser } from '../support/harness/sessions';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

/** Desfaz a transação no fim: as Configurações são globais no kore_test compartilhado. */
class Rollback extends Error {}

/**
 * As Configurações do Backoffice (Backoffice - cobrança RN10; decisão 267).
 * A troca de verdade da Indicação só roda dentro de uma transação desfeita:
 * o kore_test é compartilhado, e a comissão padrão vale para todas as suítes.
 */
describe('Backoffice: Configurações (Backoffice - cobrança RN10; banco real)', () => {
  let app: INestApplication;
  let db: BackofficePrismaService;
  let admin: { userId: string; cookie: string };
  let support: { userId: string; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(BackofficePrismaService);
    admin = await staffUser({ app, role: 'admin' });
    support = await staffUser({ app, role: 'support', name: 'Paulo Suporte' });
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const get = (cookie: string, path: string) =>
    http().get(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN);
  const put = (cookie: string, path: string, body: Record<string, unknown>) =>
    http().put(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const post = (cookie: string, path: string) =>
    http().post(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send({});
  const currentReferral = async () => {
    const settings = await db.referralSettings.findFirstOrThrow();
    return {
      defaultRatePercent: settings.defaultRatePercent,
      referralDiscountPercent: settings.referralDiscountPercent,
      commissionHoldDays: settings.commissionHoldDays,
      payoutMinCents: settings.payoutMinCents,
    };
  };

  it('RN10 - a leitura: Valores vigentes da versão de preço, a Indicação e as Integrações (o mapa not_configured)', async () => {
    const response = await get(admin.cookie, '/settings').expect(200);
    expect(response.body.current).toEqual({
      priceVersion: '2026-11',
      activationCents: 14_900,
      monthlyCents: 2_900,
      capCents: 44_900,
      pixDiscountPercent: 3,
      interestFreeUpTo: 6,
      maxInstallments: 12,
      interestBasisPoints: 399,
      interestFixedCents: 49,
      minInstallmentCents: 500,
      endDateMaxMonthsAfterEvent: 12,
      retentionMonthsAfterExpired: 6,
      payoutRequestIntervalDays: 30,
    });
    expect(response.body.referral).toMatchObject(await currentReferral());
    const names = (response.body.integrations as { name: string }[]).map(({ name }) => name);
    expect(names).toEqual(['asaas', 'email', 'maps']);
    expect(response.body.integrations[2]).toEqual({
      name: 'maps',
      status: 'not_configured',
      testedAt: null,
      local: false,
    });
    // A leitura nunca devolve credencial.
    expect(JSON.stringify(response.body)).not.toMatch(/secret|password|smtp:\/\//i);
  });

  it('RN01 e decisão 69 - o suporte recebe 403 ACTION_NOT_ALLOWED na leitura, na escrita e no teste', async () => {
    for (const response of [
      await get(support.cookie, '/settings'),
      await put(support.cookie, '/settings/referral', await currentReferral()),
      await post(support.cookie, '/integrations/asaas/test'),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('ACTION_NOT_ALLOWED');
    }
  });

  it('RN10 - "120" na comissão padrão: 422 com o campo e nada salvo; tipo errado, 400', async () => {
    const before = await currentReferral();
    const response = await put(admin.cookie, '/settings/referral', {
      ...before,
      defaultRatePercent: 120,
    }).expect(422);
    expect(response.body).toMatchObject({
      error: 'REFERRAL_SETTINGS_OUT_OF_RANGE',
      errors: [{ path: 'defaultRatePercent', code: 'MAX', params: { max: 100 } }],
    });
    expect(await currentReferral()).toEqual(before);
    // O teto técnico da coluna (int4): acima dele, 422 e não 500.
    for (const payoutMinCents of [2_147_483_648, 1e20])
      expect(
        (await put(admin.cookie, '/settings/referral', { ...before, payoutMinCents }).expect(422))
          .body.errors,
      ).toEqual([{ path: 'payoutMinCents', code: 'MAX', params: { max: 2_147_483_647 } }]);
    expect(await currentReferral()).toEqual(before);
    await put(admin.cookie, '/settings/referral', { ...before, payoutMinCents: '50' }).expect(400);
  });

  it('RN01 (B10-1) - mudar a comissão padrão pede sessão recente: 403 REAUTH_REQUIRED', async () => {
    const old = await staffUser({ app, role: 'admin' });
    await db.session.updateMany({
      where: { userId: old.userId },
      data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) },
    });
    const before = await currentReferral();
    const response = await put(old.cookie, '/settings/referral', {
      ...before,
      defaultRatePercent: before.defaultRatePercent === 22 ? 23 : 22,
    }).expect(403);
    expect(response.body.error).toBe('REAUTH_REQUIRED');
    expect(await currentReferral()).toEqual(before);
  });

  it('RN10 - salvar sem mudança responde 200, changed false, e não grava o log', async () => {
    const before = await currentReferral();
    const startedAt = new Date();
    const response = await put(admin.cookie, '/settings/referral', before).expect(200);
    expect(response.body).toMatchObject({ changed: false, referral: before });
    expect(
      await db.applicationLog.count({
        where: {
          action: 'settings.referral_updated',
          actorUserId: admin.userId,
          createdAt: { gte: startedAt },
        },
      }),
    ).toBe(0);
  });

  it('RN10 e decisão 75 - a comissão padrão de 20% → 22%: as cerimonialistas acompanham, o log tem o antes e o depois (transação desfeita)', async () => {
    const planner = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const before = await currentReferral();
    const after = { ...before, defaultRatePercent: before.defaultRatePercent === 22 ? 23 : 22 };
    const transaction = app.get(BackofficeTransaction);
    const store = app.get<AdminSettingsStore>(ADMIN_SETTINGS_STORE);
    const now = new Date();

    await expect(
      transaction.run(async () => {
        expect(await store.lockReferralSettings()).toEqual(before);
        const { plannersUpdated } = await store.updateReferralSettings({
          values: after,
          adminUserId: admin.userId,
          now,
        });
        expect(plannersUpdated).toBeGreaterThanOrEqual(1);
        await store.logReferralSettingsUpdated({ adminUserId: admin.userId, data: { after }, now });
        const tx = transaction.client();
        const referrer = await tx.referrer.findUniqueOrThrow({
          where: { userId: planner.userId },
          select: { ratePercent: true },
        });
        expect(referrer.ratePercent).toBe(after.defaultRatePercent);
        expect(await store.readReferralSettings()).toMatchObject({
          ...after,
          updatedBy: { userId: admin.userId },
        });
        expect(
          await tx.applicationLog.count({
            where: { action: 'settings.referral_updated', actorUserId: admin.userId },
          }),
        ).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);

    // Desfeita: nada mudou para as outras suítes.
    expect(await currentReferral()).toEqual(before);
  });

  it('RN10 (B10-8) - Testar conexão: o gateway local e o e-mail (Mailpit) respondem "Conectado (local)"; a leitura mostra o último teste', async () => {
    const startedAt = Date.now();
    for (const name of ['asaas', 'email']) {
      const response = await post(admin.cookie, `/integrations/${name}/test`).expect(200);
      expect(response.body).toMatchObject({ status: 'connected', local: true });
      expect(new Date(response.body.testedAt as string).getTime()).toBeGreaterThanOrEqual(
        startedAt - 1_000,
      );
    }
    const read = await get(admin.cookie, '/settings').expect(200);
    for (const integration of (read.body.integrations as { name: string }[]).slice(0, 2)) {
      expect(integration).toMatchObject({ status: 'connected', local: true });
      const testedAt = (integration as unknown as { testedAt: string }).testedAt;
      expect(new Date(testedAt).getTime()).toBeGreaterThanOrEqual(startedAt - 1_000);
    }
    expect(
      await db.applicationLog.count({
        where: {
          action: 'integration.tested',
          actorUserId: admin.userId,
          createdAt: { gte: new Date(startedAt - 1_000) },
        },
      }),
    ).toBe(2);
  });

  it('decisão 267(1) - o mapa dá 409 INTEGRATION_NOT_CONFIGURED; um nome fora da lista, 400', async () => {
    expect((await post(admin.cookie, '/integrations/maps/test').expect(409)).body.error).toBe(
      'INTEGRATION_NOT_CONFIGURED',
    );
    await post(admin.cookie, '/integrations/stripe/test').expect(400);
  });
});
