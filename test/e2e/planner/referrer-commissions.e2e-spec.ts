import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ReleaseCommissions } from '@/modules/billing/application/payouts/release-commissions.use-case';
import { addMonths } from '@/modules/billing/domain/payments/pricing';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { localDate } from '@/shared/kernel/time/local-date';
import { createTestApp } from '../support/harness/create-test-app';
import { createTestWorker } from '../support/harness/create-test-worker';
import { expectStatus, payForPublication, publishByPayment } from '../support/factories/payments';
import { seedReferrer } from '../support/factories/referrers';
import { openSession, signedInUser } from '../support/harness/sessions';
import { seedWedding } from '../support/factories/weddings';

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * A leitura das comissões pela indicadora (Comissões do indicador RN02, RN07,
 * RN08 e RN10): a tela Comissões, o Resumo de Meus casamentos e a coluna do
 * Link de indicação.
 */
describe('Comissões: a leitura da indicadora (Comissões RN07, RN08 e RN10; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
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

  const http = () => request(app.getHttpServer());

  /** Juliana indicou Ana pelo link e colabora no casamento (ou não). */
  async function referred(juliana: { userId: string }, { collaborates = true } = {}) {
    const ana = await signedInUser({ app });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: juliana.userId } });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: collaborates ? [juliana.userId] : [],
    });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: day(eventDate),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    return { ana, weddingId, referrerId: referrer.id };
  }

  async function planner() {
    const juliana = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    return { ...juliana, cookie: await openSession({ app, userId: juliana.userId }) };
  }

  it('RN02, RN07 e RN10 - os saldos, a comissão por pagamento e por casamento, sem dado do pagador', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });

    const before = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(before.body.balances).toEqual({
      availableCents: 0,
      pendingCents: commission.amountCents,
      receivedCents: 0,
      inPayoutCents: 0,
      adjustmentsCents: 0,
      paidPayouts: 0,
    });
    // Contrato de API (decisão 275): view=payment por padrão, paginado.
    expect(before.body).toMatchObject({ view: 'payment', page: 1, pageSize: 50, total: 1 });
    expect(before.body.items).toEqual([
      {
        kind: 'commission',
        commissionId: commission.id,
        weddingId,
        coupleNames: 'Ana & Marcos',
        weddingPurged: false,
        clickable: true,
        paymentKind: 'publication',
        baseAmountCents: commission.baseAmountCents,
        amountCents: commission.amountCents,
        ratePercent: 20,
        status: 'pending',
        blockReason: null,
        availableAt: commission.availableAt.toISOString(),
        paidAt: null,
        createdAt: commission.createdAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(before.body)).not.toMatch(/payer|taxId|Beatriz/i);
    const byWedding = await http()
      .get('/v1/me/referrer/commissions')
      .query({ view: 'wedding' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(byWedding.body).toMatchObject({ view: 'wedding', total: 1 });
    expect(byWedding.body.items).toEqual([
      {
        weddingId,
        coupleNames: 'Ana & Marcos',
        weddingPurged: false,
        clickable: true,
        referralSource: 'referral_link',
        paymentsCount: 1,
        pendingCents: commission.amountCents,
        availableCents: 0,
        receivedCents: 0,
        totalCents: commission.amountCents,
        releaseDates: [commission.availableAt.toISOString()],
      },
    ]);
    // O resumo da indicadora traz o percentual e os mesmos saldos, sem as legendas (346(2)).
    const me = await http().get('/v1/me/referrer').set('Cookie', juliana.cookie).expect(200);
    const { adjustmentsCents, paidPayouts, ...saldos } = before.body.balances;
    expect([adjustmentsCents, paidPayouts]).toEqual([0, 0]);
    expect(me.body).toMatchObject({ ratePercent: 20 });
    expect(me.body.balances).toEqual(saldos);

    await worker.get(ReleaseCommissions).execute({
      now: new Date(commission.availableAt.getTime() + 60_000),
      referrerId,
    });
    const after = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(after.body.balances).toMatchObject({
      availableCents: commission.amountCents,
      pendingCents: 0,
    });
  });

  it('RN07 e RN10 - sem colaborar, a linha não abre; casamento apagado, sem nome', async () => {
    const juliana = await planner();
    const { ana, weddingId } = await referred(juliana, { collaborates: false });
    await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const closed = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(closed.body.items[0]).toMatchObject({
      weddingId: null,
      clickable: false,
      coupleNames: 'Ana & Marcos',
    });

    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'purged',
        purgedAt: new Date(),
        endDate: null,
        paidThrough: null,
        publicationSource: null,
      },
    });
    const purged = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(purged.body.items[0]).toMatchObject({
      weddingPurged: true,
      coupleNames: null,
      weddingId: null,
    });
  });

  it('RN08 (decisões 316(15) e 338(11)) - Meus casamentos: o filtro Rascunho deixa de fora o aguardando pagamento', async () => {
    const juliana = await planner();
    const { ana, weddingId: awaitingId } = await referred(juliana);
    const { weddingId: draftId } = await referred(juliana);
    expectStatus(
      await payForPublication({
        app,
        cookie: ana.cookie,
        weddingId: awaitingId,
        endDate,
        method: 'pix',
      }),
      201,
    );
    const ids = async (status: string) =>
      (
        (
          await http()
            .get('/v1/me/weddings')
            .query({ status })
            .set('Cookie', juliana.cookie)
            .expect(200)
        ).body.weddings as { weddingId: string; status: string }[]
      ).map((item) => item.weddingId);
    expect(await ids('draft')).toEqual([draftId]);
    expect(await ids('awaiting_payment')).toEqual([awaitingId]);
    // Os dois seguem com o status draft na lista sem filtro.
    const all = await http().get('/v1/me/weddings').set('Cookie', juliana.cookie).expect(200);
    expect(
      (all.body.weddings as { weddingId: string; status: string }[])
        .filter((item) => [awaitingId, draftId].includes(item.weddingId))
        .map((item) => item.status),
    ).toEqual(['draft', 'draft']);
  });

  it('RN08 - Meus casamentos: Aguardando pagamento e Comissão disponível no Resumo; o item marcado', async () => {
    const juliana = await planner();
    const { ana, weddingId } = await referred(juliana);
    expectStatus(
      await payForPublication({ app, cookie: ana.cookie, weddingId, endDate, method: 'pix' }),
      201,
    );
    const mine = await http().get('/v1/me/weddings').set('Cookie', juliana.cookie).expect(200);
    expect(mine.body.summary).toMatchObject({ awaitingPayment: 1, commissionAvailableCents: 0 });
    expect(
      (mine.body.weddings as { weddingId: string; awaitingPayment: boolean }[]).find(
        (item) => item.weddingId === weddingId,
      ),
    ).toMatchObject({ awaitingPayment: true, status: 'draft' });
    const detail = await http()
      .get(`/v1/me/weddings/${weddingId}`)
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(detail.body.awaitingPayment).toBe(true);
    // O filtro aceita awaiting_payment (Contrato de API; decisão 275): só a lista muda.
    const filtered = await http()
      .get('/v1/me/weddings')
      .query({ status: 'awaiting_payment' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(
      (filtered.body.weddings as { weddingId: string }[]).map((item) => item.weddingId),
    ).toEqual([weddingId]);
    expect(filtered.body.summary).toEqual(mine.body.summary);
    const published = await http()
      .get('/v1/me/weddings')
      .query({ status: 'published' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(published.body.weddings).toEqual([]);
    await http()
      .get('/v1/me/weddings')
      .query({ status: 'unknown' })
      .set('Cookie', juliana.cookie)
      .expect(400);
  });

  it('RN08 - a coluna Comissão do Link de indicação: a soma por estado; sem pagamento, nula', async () => {
    const juliana = await planner();
    const paid = await referred(juliana);
    const { paymentId } = await publishByPayment({
      app,
      cookie: paid.ana.cookie,
      weddingId: paid.weddingId,
      endDate,
    });
    const unpaid = await referred(juliana);
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });

    const link = await http()
      .get('/v1/me/referrer/weddings')
      .set('Cookie', juliana.cookie)
      .expect(200);
    const byId = new Map(
      (link.body as { weddingId: string; commission: unknown }[]).map((row) => [
        row.weddingId,
        row.commission,
      ]),
    );
    expect(byId.get(paid.weddingId)).toEqual({
      totalCents: commission.amountCents,
      byStatus: [{ status: 'pending', amountCents: commission.amountCents }],
    });
    expect(byId.get(unpaid.weddingId)).toBeNull();
  });

  it('RN07 (decisão 275) - os ajustes saem na aba Por pagamento, em linha própria, com o repasse em que entraram; o bloqueio traz o motivo; a página', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.update({
      where: { paymentId },
      data: { status: 'blocked', blockReason: 'admin' },
    });
    const adjustment = await db.commissionAdjustment.create({
      data: { id: uuidV7(), referrerId, amountCents: -1_000, reason: 'manual', note: 'Teste' },
    });

    const list = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(list.body.total).toBe(2);
    // O mais novo primeiro: o ajuste, depois a comissão.
    expect(list.body.items).toEqual([
      {
        kind: 'adjustment',
        adjustmentId: adjustment.id,
        coupleNames: null,
        weddingPurged: false,
        amountCents: -1_000,
        reason: 'manual',
        createdAt: adjustment.createdAt.toISOString(),
        payoutStatus: null,
      },
      expect.objectContaining({
        kind: 'commission',
        commissionId: commission.id,
        status: 'blocked',
        blockReason: 'admin',
      }),
    ]);
    const second = await http()
      .get('/v1/me/referrer/commissions')
      .query({ page: 2 })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(second.body).toMatchObject({ page: 2, total: 2, items: [] });
    await http()
      .get('/v1/me/referrer/commissions')
      .query({ view: 'other' })
      .set('Cookie', juliana.cookie)
      .expect(400);
  });

  /** Os repasses da indicadora, com a chave Pix ativa que eles levam. */
  async function payoutsOf(referrerId: string) {
    const key = await db.referrerPixKey.create({
      data: {
        id: uuidV7(),
        referrerId,
        keyType: 'email',
        keyEncrypted: 'cifrado',
        keyHash: `hash-${uuidV7()}`,
        keyMasked: 'jul***@prado.com.br',
        status: 'active',
        confirmedAt: new Date(),
        activeFrom: new Date(),
      },
    });
    return (status: 'paid' | 'requested') =>
      db.payout.create({
        data: {
          id: uuidV7(),
          referrerId,
          amountCents: 5_000,
          status,
          pixKeyId: key.id,
          pixKeyMasked: key.keyMasked,
          externalRef: `payout-${uuidV7()}`,
          idempotencyKey: uuidV7(),
          requestedAt: new Date(),
          paidAt: status === 'paid' ? new Date() : null,
        },
      });
  }

  it('RN02, RN07 e RN08 (decisão 346) - por casamento, a origem, os pagamentos, o já recebido e o total; nos saldos, o ajuste do Disponível e os repasses pagos', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const payout = await payoutsOf(referrerId);
    const paidPayout = await payout('paid');
    await payout('paid');
    const openPayout = await payout('requested');
    // A comissão da publicação foi paga num repasse.
    const paid = await db.commission.update({
      where: { paymentId },
      data: { status: 'paid', paidAt: new Date(), payoutId: paidPayout.id },
    });
    await db.commissionAdjustment.createMany({
      data: [
        { id: uuidV7(), referrerId, amountCents: -5_002, reason: 'manual', note: 'Teste' },
        {
          id: uuidV7(),
          referrerId,
          amountCents: -700,
          reason: 'manual',
          note: 'Teste',
          payoutId: openPayout.id,
        },
      ],
    });

    const byWedding = await http()
      .get('/v1/me/referrer/commissions')
      .query({ view: 'wedding' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(byWedding.body.balances).toMatchObject({
      receivedCents: paid.amountCents,
      adjustmentsCents: -5_002,
      paidPayouts: 2,
    });
    expect(byWedding.body.items).toEqual([
      expect.objectContaining({
        weddingId,
        referralSource: 'referral_link',
        paymentsCount: 1,
        availableCents: 0,
        pendingCents: 0,
        receivedCents: paid.amountCents,
        totalCents: paid.amountCents,
        releaseDates: [],
      }),
    ]);
    // Sem percentual novo (315(1)): só o ratePercent que já existia na aba Por pagamento.
    expect(JSON.stringify(byWedding.body)).not.toMatch(/percent/i);

    // A origem acompanha o casamento: reatribuído pelo Admin, vem admin_reassigned.
    await db.wedding.update({
      where: { id: weddingId },
      data: { referralSource: 'admin_reassigned' },
    });
    const reassigned = await http()
      .get('/v1/me/referrer/commissions')
      .query({ view: 'wedding' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(reassigned.body.items[0].referralSource).toBe('admin_reassigned');
  });

  it('RN07 (decisão 347(2)) - a linha do ajuste mostra o casamento; nulo no manual e, depois do expurgo, a lápide', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });
    const refund = await db.commissionAdjustment.create({
      data: {
        id: uuidV7(),
        referrerId,
        commissionId: commission.id,
        amountCents: -commission.amountCents,
        reason: 'refund',
      },
    });
    const manual = await db.commissionAdjustment.create({
      data: { id: uuidV7(), referrerId, amountCents: -1_000, reason: 'manual', note: 'Teste' },
    });
    const adjustmentsOf = async () => {
      const list = await http()
        .get('/v1/me/referrer/commissions')
        .set('Cookie', juliana.cookie)
        .expect(200);
      return new Map(
        (
          list.body.items as {
            kind: string;
            adjustmentId?: string;
            coupleNames: string | null;
            weddingPurged: boolean;
          }[]
        )
          .filter((item) => item.kind === 'adjustment')
          .map((item) => [
            item.adjustmentId,
            { coupleNames: item.coupleNames, weddingPurged: item.weddingPurged },
          ]),
      );
    };
    expect(await adjustmentsOf()).toEqual(
      new Map([
        [manual.id, { coupleNames: null, weddingPurged: false }],
        [refund.id, { coupleNames: 'Ana & Marcos', weddingPurged: false }],
      ]),
    );

    await db.wedding.update({
      where: { id: weddingId },
      data: {
        status: 'purged',
        purgedAt: new Date(),
        endDate: null,
        paidThrough: null,
        publicationSource: null,
      },
    });
    expect((await adjustmentsOf()).get(refund.id)).toEqual({
      coupleNames: null,
      weddingPurged: true,
    });
  });

  it('RN02 e RN07 (decisão 350(12)) - por casamento, o Disponível, o Já recebido e o Total levam os ajustes do casal, como o topo; o manual fica só no topo', async () => {
    const juliana = await planner();
    const { ana, weddingId, referrerId } = await referred(juliana);
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const payout = await payoutsOf(referrerId);
    const paidPayout = await payout('paid');
    const openPayout = await payout('requested');
    const paid = await db.commission.update({
      where: { paymentId },
      data: { status: 'paid', paidAt: new Date(), payoutId: paidPayout.id },
    });
    const refund = { referrerId, commissionId: paid.id, reason: 'refund' as const };
    await db.commissionAdjustment.createMany({
      data: [
        // Sem repasse: no Disponível.
        { ...refund, id: uuidV7(), amountCents: -1_000 },
        // Num repasse aberto: o "em repasse" do topo, fora do Disponível e do Já recebido.
        { ...refund, id: uuidV7(), amountCents: -300, payoutId: openPayout.id },
        // Num repasse pago: no Já recebido.
        { ...refund, id: uuidV7(), amountCents: -2_000, payoutId: paidPayout.id },
        // O manual, sem casamento: só no topo.
        { id: uuidV7(), referrerId, amountCents: -7_000, reason: 'manual', note: 'Teste' },
      ],
    });

    const byWedding = await http()
      .get('/v1/me/referrer/commissions')
      .query({ view: 'wedding' })
      .set('Cookie', juliana.cookie)
      .expect(200);
    expect(byWedding.body.balances).toMatchObject({
      availableCents: -1_000 - 7_000,
      receivedCents: paid.amountCents - 2_000,
      inPayoutCents: -300,
    });
    expect(byWedding.body.items).toEqual([
      expect.objectContaining({
        weddingId,
        paymentsCount: 1,
        availableCents: -1_000,
        pendingCents: 0,
        receivedCents: paid.amountCents - 2_000,
        totalCents: paid.amountCents - 1_000 - 300 - 2_000,
      }),
    ]);
  });
});
