import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  PayPayout,
  ReconcilePayouts,
  RetryPayout,
  SendPayoutTransfer,
} from '../../src/modules/billing/application/payouts/payout-transfers.use-cases';
import { ReleaseCommissions } from '../../src/modules/billing/application/release-commissions.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import {
  PayoutAmountMismatchError,
  PayoutReferrerBlockedError,
  PayoutStatusConflictError,
} from '../../src/modules/billing/domain/payout.errors';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import {
  FIELD_CIPHER,
  type FieldCipher,
} from '../../src/shared/crypto/application/field-cipher.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { devPaymentEvent, expectStatus, publishByPayment } from '../support/payments';
import { seedReferrer } from '../support/referrers';
import { openSession, signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const APP_ORIGIN = 'http://localhost:5173';

/** Espera a condição (o job do Pix de saída roda no worker). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('A condição não chegou a tempo.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * O Pix de saída do repasse (Repasse e Dados para receber RN05 e RN08;
 * Comissões RN05, B6-4): o Pagar com a conferência, o job, o pago, a falha, o
 * sem resposta com o Tentar de novo e a conciliação diária.
 */
describe('Repasse: o Pix de saída (Repasse RN05 e RN08; banco real)', () => {
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
  const ask = (cookie: string, expectedAmountCents: number) =>
    http()
      .post('/v1/me/referrer/payouts')
      .set('Cookie', cookie)
      .set('Origin', APP_ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({ expectedAmountCents });
  const payout = (id: string) => db.payout.findUniqueOrThrow({ where: { id } });
  const admin = async () =>
    (await db.user.create({ data: { email: `admin.${randomUUID()}@kore.local` } })).id;

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
          keyEncrypted: await app.get<FieldCipher>(FIELD_CIPHER).encrypt({
            plaintext: 'juliana@pradoassessoria.com.br',
            context: { table: 'referrer_pix_keys', column: 'key_encrypted' },
          }),
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

  /** Juliana pediu o repasse da comissão; o Admin toca em Pagar. */
  async function requested() {
    const person = await juliana();
    const created = await ask(person.cookie, person.commission.amountCents).expect(201);
    const { email } = await db.user.findUniqueOrThrow({ where: { id: person.userId } });
    return { ...person, email, payoutId: created.body.id as string };
  }

  it('RN05 - Pagar: processing, o Pix sai pelo job para a chave do pedido; o gateway confirma e fica pago, com o e-mail', async () => {
    const person = await requested();
    const adminId = await admin();

    await worker.get(PayPayout).execute({
      payoutId: person.payoutId,
      adminUserId: adminId,
      idempotencyKey: randomUUID(),
      now: new Date(),
    });

    const { externalRef } = await payout(person.payoutId);
    const transfer = await until(
      () => app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
      (value) => value !== null,
    );
    expect(transfer).toMatchObject({
      amount_cents: person.commission.amountCents,
      status: 'processing',
    });
    expect(await payout(person.payoutId)).toMatchObject({
      status: 'processing',
      paidByUserId: adminId,
    });
    // Pagar de novo não manda outro Pix.
    await expect(
      worker.get(PayPayout).execute({
        payoutId: person.payoutId,
        adminUserId: adminId,
        idempotencyKey: randomUUID(),
        now: new Date(),
      }),
    ).rejects.toThrow(PayoutStatusConflictError);

    expectStatus(await devPaymentEvent({ app, paymentId: externalRef, event: 'payout-paid' }), 200);

    expect(await payout(person.payoutId)).toMatchObject({
      status: 'paid',
      gatewayTransferId: transfer!.id,
    });
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({
      status: 'paid',
    });
    const [mail] = await waitForInbox({ to: person.email });
    expect(mail.Subject).toBe('Repasse pago');
    const balances = await http()
      .get('/v1/me/referrer/commissions')
      .set('Cookie', person.cookie)
      .expect(200);
    expect(balances.body.balances).toMatchObject({
      receivedCents: person.commission.amountCents,
      inPayoutCents: 0,
    });
  });

  it('RN05 (B7-3) - a conferência antes de pagar: valor diferente, indicador bloqueado e repasse que não está solicitado', async () => {
    const mismatch = await requested();
    // O Admin liberou sem recalcular: uma comissão estornada continua no pedido.
    await db.commission.update({
      where: { id: mismatch.commission.id },
      data: { status: 'reversed', reversedAt: new Date() },
    });
    await db.payout.update({
      where: { id: mismatch.payoutId },
      data: { status: 'requested', holdReason: null },
    });
    await expect(
      worker.get(PayPayout).execute({
        payoutId: mismatch.payoutId,
        adminUserId: await admin(),
        idempotencyKey: randomUUID(),
        now: new Date(),
      }),
    ).rejects.toThrow(PayoutAmountMismatchError);

    const blocked = await requested();
    await db.referrer.update({ where: { id: blocked.referrerId }, data: { status: 'blocked' } });
    await expect(
      worker.get(PayPayout).execute({
        payoutId: blocked.payoutId,
        adminUserId: await admin(),
        idempotencyKey: randomUUID(),
        now: new Date(),
      }),
    ).rejects.toThrow(PayoutReferrerBlockedError);
    expect(await payout(blocked.payoutId)).toMatchObject({ status: 'requested' });
  });

  it('RN05 - falha definitiva: volta a solicitado, com o motivo e o alerta payout_failed', async () => {
    const person = await requested();
    await worker.get(PayPayout).execute({
      payoutId: person.payoutId,
      adminUserId: await admin(),
      idempotencyKey: randomUUID(),
      now: new Date(),
    });
    const { externalRef } = await payout(person.payoutId);
    await until(
      () => app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
      (value) => value !== null,
    );

    expectStatus(
      await devPaymentEvent({ app, paymentId: externalRef, event: 'payout-failed' }),
      200,
    );

    expect(await payout(person.payoutId)).toMatchObject({
      status: 'requested',
      lastError: 'pix_key_not_found',
      paidAt: null,
    });
    expect(
      await db.alert.count({
        where: { type: 'payout_failed', entityId: person.payoutId, status: 'open' },
      }),
    ).toBe(1);
  });

  it('RN05 (B7-2) - sem resposta: fica em processamento com o alerta; o Tentar de novo consulta antes e manda uma vez só', async () => {
    const person = await requested();
    const { externalRef } = await payout(person.payoutId);
    await app.get(LocalGatewayStore).failNextCalls({ count: 1, scope: externalRef });
    await worker.get(PayPayout).execute({
      payoutId: person.payoutId,
      adminUserId: await admin(),
      idempotencyKey: randomUUID(),
      now: new Date(),
    });

    const stuck = await until(
      () => payout(person.payoutId),
      (value) => value.lastError === 'gateway_unavailable',
    );
    expect(stuck.status).toBe('processing');
    expect(
      await app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
    ).toBeNull();
    expect(
      await db.alert.count({
        where: { type: 'payout_failed', entityId: person.payoutId, status: 'open' },
      }),
    ).toBe(1);

    expect(
      await worker
        .get(RetryPayout)
        .execute({ payoutId: person.payoutId, adminUserId: await admin(), now: new Date() }),
    ).toBe('pending');
    await until(
      () => app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
      (value) => value !== null,
    );
    // Achou na consulta: aplica, sem mandar de novo.
    expect(
      await worker.get(SendPayoutTransfer).execute({ payoutId: person.payoutId, now: new Date() }),
    ).toBe('pending');
  });

  it('Comissões RN05 (B6-4) - estornada durante o Pix: o repasse pago leva o ajuste negativo', async () => {
    const person = await requested();
    await worker.get(PayPayout).execute({
      payoutId: person.payoutId,
      adminUserId: await admin(),
      idempotencyKey: randomUUID(),
      now: new Date(),
    });
    const { externalRef } = await payout(person.payoutId);
    await until(
      () => app.get(LocalGatewayStore).transferByReference({ externalReference: externalRef }),
      (value) => value !== null,
    );
    await http()
      .post(`/v1/weddings/${person.weddingId}/payments/${person.paymentId}/refund-request`)
      .set('Cookie', person.ana.cookie)
      .set('Origin', APP_ORIGIN)
      .send({})
      .expect(202);
    expectStatus(await devPaymentEvent({ app, paymentId: person.paymentId, event: 'refund' }), 200);
    // Em processamento, a comissão fica retida pelo pedido e não é estornada (o Pix decide).
    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({
      status: 'held',
    });

    expectStatus(await devPaymentEvent({ app, paymentId: externalRef, event: 'payout-paid' }), 200);

    expect(
      await db.commission.findUniqueOrThrow({ where: { id: person.commission.id } }),
    ).toMatchObject({
      status: 'paid',
    });
    expect(
      await db.commissionAdjustment.findMany({
        where: { commissionId: person.commission.id },
        select: { amountCents: true, reason: true },
      }),
    ).toEqual([{ amountCents: -person.commission.amountCents, reason: 'refund' }]);
  });

  it('Casos de borda - a conciliação diária: o repasse em processamento sem Pix no gateway fica com o alerta', async () => {
    const person = await requested();
    // Em processamento, mas o Pix nunca chegou ao gateway (o job se perdeu).
    await db.payout.update({
      where: { id: person.payoutId },
      data: { status: 'processing', processingAt: new Date() },
    });

    const tally = await worker
      .get(ReconcilePayouts)
      .execute({ now: new Date(), payoutId: person.payoutId });

    expect(tally.pending).toBe(1);
    expect(await payout(person.payoutId)).toMatchObject({
      status: 'processing',
      lastError: 'transfer_not_found',
    });
    expect(
      await db.alert.count({
        where: { type: 'payout_failed', entityId: person.payoutId, status: 'open' },
      }),
    ).toBe(1);
  });
});
