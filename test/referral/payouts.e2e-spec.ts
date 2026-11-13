import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { devPaymentEvent, expectStatus, publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/**
 * O pedido de repasse (Repasse e Dados para receber RN04, RN06 e RN07; Comissões
 * RN02 e RN05; decisão 247): o saldo, as recusas e as retenções.
 */
describe('Repasse: o pedido e as retenções (Repasse RN04 e RN06; decisão 247; banco real)', () => {
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
  const list = (cookie: string) =>
    http().get('/v1/me/referrer/payouts').set('Cookie', cookie).expect(200);
  const ask = (cookie: string, expectedAmountCents: number, key: string = randomUUID()) =>
    http()
      .post('/v1/me/referrer/payouts')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .set('Idempotency-Key', key)
      .send({ expectedAmountCents });

  /**
   * Juliana com os dados para receber (CPF e chave ativa) e uma comissão
   * disponível de um casamento indicado (Ana pagou; a rodada liberou).
   */
  async function juliana({ payoutData = true }: { payoutData?: boolean } = {}) {
    const seeded = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: seeded.userId } });
    if (payoutData) {
      await db.referrer.update({
        where: { id: referrer.id },
        data: {
          taxIdType: 'cpf',
          taxIdEncrypted: 'cifrado',
          taxIdHash: `hash-${randomUUID()}`,
          taxIdHashVersion: 1,
        },
      });
      await db.referrerPixKey.create({
        data: {
          id: uuidV7(),
          referrerId: referrer.id,
          keyType: 'email',
          keyEncrypted: 'cifrado',
          keyHash: `hash-${randomUUID()}`,
          keyMasked: 'jul***@pradoassessoria.com.br',
          status: 'active',
          confirmedAt: new Date(),
          activeFrom: new Date(),
        },
      });
    }
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    const commission = await db.commission.findUniqueOrThrow({ where: { paymentId } });
    await worker.get(ReleaseCommissions).execute({
      now: new Date(commission.availableAt.getTime() + 60_000),
      referrerId: referrer.id,
    });
    return {
      ...seeded,
      referrerId: referrer.id,
      ana,
      weddingId,
      paymentId,
      commission,
      cookie: await openSession({ app, userId: seeded.userId }),
    };
  }

  it('RN04 - o pedido toma as comissões disponíveis; a mesma chave devolve o mesmo; outro valor com ela, 422', async () => {
    const person = await juliana();
    const before = await list(person.cookie);
    expect(before.body).toMatchObject({
      payoutsEnabled: true,
      nextRequestAt: null,
      pixKeyActiveFrom: null,
      items: [],
    });

    const key = randomUUID();
    const created = await ask(person.cookie, person.commission.amountCents, key).expect(201);
    expect(created.body).toMatchObject({
      amountCents: person.commission.amountCents,
      status: 'requested',
      holdReason: null,
      pixKeyMasked: 'jul***@pradoassessoria.com.br',
      receiptUrl: null,
    });
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({ payoutId: created.body.id, status: 'available' });

    expect((await ask(person.cookie, person.commission.amountCents, key).expect(201)).body.id).toBe(
      created.body.id,
    );
    expect((await ask(person.cookie, 100_00, key).expect(422)).body.error).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    await http()
      .post('/v1/me/referrer/payouts')
      .set('Cookie', person.cookie)
      .set('Origin', APP_ORIGIN)
      .send({ expectedAmountCents: 1 })
      .expect(400);

    const after = await list(person.cookie);
    expect(after.body.items).toEqual([expect.objectContaining({ id: created.body.id })]);
    expect(after.body.nextRequestAt).toEqual(expect.any(String));
    const balances = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(balances.body.balances).toMatchObject({
      availableCents: 0,
      inPayoutCents: person.commission.amountCents,
    });
  });

  it('decisão 247(2) e RN07 - com um aberto, PAYOUT_OPEN; o recusado não conta para os 30 dias; o pago, conta', async () => {
    const person = await juliana();
    const first = await ask(person.cookie, person.commission.amountCents).expect(201);

    const open = await ask(person.cookie, person.commission.amountCents).expect(409);
    expect(open.body).toMatchObject({ error: 'PAYOUT_OPEN', payoutId: first.body.id });

    // O Admin recusa: as comissões voltam ao saldo, e o pedido de hoje não conta.
    await db.commission.updateMany({
      where: { payoutId: first.body.id },
      data: { payoutId: null },
    });
    await db.payout.update({
      where: { id: first.body.id },
      data: { status: 'rejected', rejectedAt: new Date(), rejectReason: 'Teste' },
    });
    const second = await ask(person.cookie, person.commission.amountCents).expect(201);

    // Pago hoje: o próximo só daqui a 30 dias.
    await db.commission.updateMany({
      where: { payoutId: second.body.id },
      data: { status: 'paid', paidAt: new Date() },
    });
    await db.payout.update({
      where: { id: second.body.id },
      data: { status: 'paid', paidAt: new Date() },
    });
    const soon = await ask(person.cookie, 5_000).expect(409);
    expect(soon.body.error).toBe('PAYOUT_TOO_SOON');
    expect(soon.body.nextRequestAt).toBe((await list(person.cookie)).body.nextRequestAt);
  });

  it('RN04 - sem os dados, abaixo do mínimo (com o ajuste negativo) e com o saldo mudado: as recusas com o que a tela mostra', async () => {
    const noData = await juliana({ payoutData: false });
    expect((await ask(noData.cookie, noData.commission.amountCents).expect(409)).body.error).toBe(
      'PAYOUT_DATA_MISSING',
    );

    const person = await juliana();
    const changed = await ask(person.cookie, person.commission.amountCents + 1).expect(409);
    expect(changed.body).toMatchObject({
      error: 'PAYOUT_AMOUNT_CHANGED',
      amountCents: person.commission.amountCents,
    });

    // Um ajuste negativo sem repasse abate o saldo (Comissões RN02 e RN05).
    const adjustment = person.commission.amountCents - 3_760;
    await db.commissionAdjustment.create({
      data: {
        id: uuidV7(),
        referrerId: person.referrerId,
        amountCents: -adjustment,
        reason: 'manual',
        note: 'Teste',
      },
    });
    const below = await ask(person.cookie, 3_760).expect(409);
    expect(below.body).toMatchObject({
      error: 'PAYOUT_BELOW_MINIMUM',
      balanceCents: 3_760,
      minimumCents: 5_000,
    });
  });

  it('RN03 - com uma troca da chave que ainda não vale: PIX_KEY_CHANGE_PENDING com a data', async () => {
    const person = await juliana();
    const activeFrom = new Date(Date.now() + 48 * 60 * 60_000);
    await db.referrerPixKey.create({
      data: {
        id: uuidV7(),
        referrerId: person.referrerId,
        keyType: 'random',
        keyEncrypted: 'cifrado',
        keyHash: `hash-${randomUUID()}`,
        keyMasked: 'a1b2…c3d4',
        status: 'pending_activation',
        confirmedAt: new Date(),
        activeFrom,
      },
    });
    const pending = await ask(person.cookie, person.commission.amountCents).expect(409);
    expect(pending.body).toMatchObject({
      error: 'PIX_KEY_CHANGE_PENDING',
      activeFrom: activeFrom.toISOString(),
    });
    expect((await list(person.cookie)).body.pixKeyActiveFrom).toBe(activeFrom.toISOString());
  });

  it('RN06 e decisão 247(3) - o pedido de reembolso retém o repasse; o estorno confirmado o deixa retido', async () => {
    const person = await juliana();
    const payout = await ask(person.cookie, person.commission.amountCents).expect(201);

    await http()
      .post(`/v1/weddings/${person.weddingId}/payments/${person.paymentId}/refund-request`)
      .set('Cookie', person.ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({})
      .expect(202);
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.body.id } })).toMatchObject({
      status: 'held',
      holdReason: 'refund',
    });

    expectStatus(await devPaymentEvent({ app, paymentId: person.paymentId, event: 'refund' }), 200);
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({ status: 'reversed', payoutId: payout.body.id });
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.body.id } })).toMatchObject({
      status: 'held',
      holdReason: 'refund',
    });
  });

  it('RN06 (d) - a contestação retém o repasse; ganha, ele volta a solicitado', async () => {
    const person = await juliana();
    const payout = await ask(person.cookie, person.commission.amountCents).expect(201);

    expectStatus(
      await devPaymentEvent({ app, paymentId: person.paymentId, event: 'dispute' }),
      200,
    );
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.body.id } })).toMatchObject({
      status: 'held',
      holdReason: 'dispute',
    });

    expectStatus(
      await devPaymentEvent({ app, paymentId: person.paymentId, event: 'dispute-won' }),
      200,
    );
    expect(await db.payout.findUniqueOrThrow({ where: { id: payout.body.id } })).toMatchObject({
      status: 'requested',
      holdReason: null,
    });
  });

  it('Comissões RN05 - o estorno da comissão já paga cria o ajuste negativo, uma vez só', async () => {
    const person = await juliana();
    await db.commission.update({
      where: { id: person.commission.id },
      data: { status: 'paid', paidAt: new Date() },
    });

    // O casal pede o reembolso, e o gateway confirma (duas vezes: o mesmo estorno não repete).
    await http()
      .post(`/v1/weddings/${person.weddingId}/payments/${person.paymentId}/refund-request`)
      .set('Cookie', person.ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({})
      .expect(202);
    expectStatus(await devPaymentEvent({ app, paymentId: person.paymentId, event: 'refund' }), 200);
    expectStatus(await devPaymentEvent({ app, paymentId: person.paymentId, event: 'refund' }), 200);

    expect(
      await db.commissionAdjustment.findMany({
        where: { commissionId: person.commission.id },
        select: { amountCents: true, reason: true, payoutId: true },
      }),
    ).toEqual([{ amountCents: -person.commission.amountCents, reason: 'refund', payoutId: null }]);
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({ status: 'paid' });
    const balances = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(balances.body.balances.availableCents).toBe(-person.commission.amountCents);
  });
});
