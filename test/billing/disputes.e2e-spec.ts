import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { ReconcilePayments } from '../../src/modules/billing/application/reconcile-payments.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import {
  devPaymentEvent,
  expectStatus,
  publishByPayment,
  seedPaidExtension,
} from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * A contestação (Pagamentos e arrependimento RN06; Publicar e pagar RN10) pela
 * rota dev do adaptador local, que processa em linha: aberta, ganha e perdida,
 * sem cascata (B3-4), com o estorno já pedido e com o casamento apagado (B3-8).
 */
describe('Contestação (Pagamentos e arrependimento RN06; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let gateway: LocalGatewayStore;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    gateway = app.get(LocalGatewayStore);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  async function published() {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    return { ana, weddingId, paymentId };
  }

  const payment = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });
  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });
  const dispute = (paymentId: string, event: string) =>
    devPaymentEvent({ app, paymentId, event }).then((response) => expectStatus(response, 200));
  const billing = (cookie: string, weddingId: string) =>
    request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', cookie)
      .expect(200);

  it('RN06 (B3-4) - contestação da publicação com extensão por cima: aberta, sem Desistir; perdida, sem cascata', async () => {
    const { ana, weddingId, paymentId } = await published();
    const extensionEnd = addMonths({ day: endDate, months: 3 });
    const extensionId = await seedPaidExtension({
      db,
      gateway,
      weddingId,
      ownerId: ana.userId,
      periodStart: endDate,
      periodEnd: extensionEnd,
    });

    await dispute(paymentId, 'dispute');
    const disputed = await payment(paymentId);
    expect(disputed.status).toBe('disputed');
    expect(disputed.disputedAt).not.toBeNull();
    expect(disputed.disputeDeadline).not.toBeNull();
    const deadline = disputed.disputeDeadline!.toISOString().slice(0, 10);
    expect(
      await db.alert.findFirstOrThrow({
        where: { type: 'payment_disputed', entityId: paymentId, status: 'open' },
      }),
    ).toMatchObject({ data: expect.objectContaining({ disputeDeadline: deadline }) });
    // O site continua no ar; a Situação é "Em contestação", com o prazo, sem Desistir.
    expect((await wedding(weddingId)).status).toBe('published');
    const rows = (await billing(ana.cookie, weddingId)).body.payments as { id: string }[];
    const row = rows.find((item) => item.id === paymentId);
    expect(row).toMatchObject({
      status: 'disputed',
      disputeDeadline: deadline,
      refundableUntil: null,
    });
    const refused = await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({})
      .expect(409);
    expect(refused.body).toMatchObject({ error: 'PAYMENT_DISPUTED' });

    await dispute(paymentId, 'dispute-lost');
    const lost = await payment(paymentId);
    expect(lost).toMatchObject({ status: 'refunded', refundOrigin: 'chargeback' });
    expect(lost.refundedAt).not.toBeNull();
    expect(lost.disputeResolvedAt).not.toBeNull();
    // Sem cascata: a extensão continua paga e o site segue no ar até a data dela.
    expect(await payment(extensionId)).toMatchObject({ status: 'paid' });
    const after = await wedding(weddingId);
    expect(after.status).toBe('published');
    expect(after.endDate).toEqual(day(extensionEnd));
    expect(
      await db.alert.count({
        where: { type: 'dispute_lost', entityId: paymentId, status: 'open' },
      }),
    ).toBe(1);
    const actions = (
      await db.applicationLog.findMany({ where: { entityId: paymentId }, select: { action: true } })
    ).map((log) => log.action);
    expect(actions).toEqual(expect.arrayContaining(['payment.disputed', 'payment.dispute_lost']));
  });

  it('RN06 - contestação ganha: volta a paid; o evento repetido não abre outra', async () => {
    const { weddingId, paymentId } = await published();
    await dispute(paymentId, 'dispute');
    await dispute(paymentId, 'dispute');
    expect(
      await db.applicationLog.count({ where: { entityId: paymentId, action: 'payment.disputed' } }),
    ).toBe(1);
    expect(await db.alert.count({ where: { type: 'payment_disputed', entityId: paymentId } })).toBe(
      1,
    );
    // A diária não acusa diferença na contestação aberta.
    const tally = await worker.get(ReconcilePayments).settled({ now: new Date(), weddingId });
    expect(tally).toMatchObject({ checked: 1, alerts: 0 });

    await dispute(paymentId, 'dispute-won');
    const won = await payment(paymentId);
    expect(won.status).toBe('paid');
    expect(won.disputeResolvedAt).not.toBeNull();
    expect(
      await db.applicationLog.count({
        where: { entityId: paymentId, action: 'payment.dispute_won' },
      }),
    ).toBe(1);
    expect((await wedding(weddingId)).status).toBe('published');
  });

  it('Publicar e pagar RN10 - contestação com o estorno já pedido: grava a data e o alerta e mantém refund_requested', async () => {
    const { ana, weddingId, paymentId } = await published();
    await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({})
      .expect(202);

    await dispute(paymentId, 'dispute');
    const disputed = await payment(paymentId);
    expect(disputed).toMatchObject({ status: 'refund_requested', refundOrigin: 'couple' });
    expect(disputed.disputedAt).not.toBeNull();
    expect(await db.alert.count({ where: { type: 'payment_disputed', entityId: paymentId } })).toBe(
      1,
    );

    // Perdida: o banco devolveu; o pedido fica estornado, com a origem do pedido.
    await dispute(paymentId, 'dispute-lost');
    expect(await payment(paymentId)).toMatchObject({ status: 'refunded', refundOrigin: 'couple' });
  });

  it('Publicar e pagar RN10 - contestação depois do estorno: só o alerta', async () => {
    const { ana, weddingId, paymentId } = await published();
    await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
      .set('Cookie', ana.cookie)
      .set('Origin', ORIGIN)
      .send({})
      .expect(202);
    await dispute(paymentId, 'refund');
    expect((await payment(paymentId)).status).toBe('refunded');

    await dispute(paymentId, 'dispute');
    const after = await payment(paymentId);
    expect(after.status).toBe('refunded');
    expect(after.disputedAt).toBeNull();
    expect(await db.alert.count({ where: { type: 'payment_disputed', entityId: paymentId } })).toBe(
      1,
    );
  });

  it('RN06 (B3-8) - contestação de um casamento já apagado: o pagamento fica em contestação e o casamento não muda', async () => {
    const { weddingId, paymentId } = await published();
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
    const before = await wedding(weddingId);

    await dispute(paymentId, 'dispute');
    expect(await payment(paymentId)).toMatchObject({ status: 'disputed' });
    const after = await wedding(weddingId);
    expect(after.status).toBe('purged');
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
