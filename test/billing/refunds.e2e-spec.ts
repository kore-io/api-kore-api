import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ProcessRefund } from '../../src/modules/billing/application/process-refund.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import {
  devPaymentEvent,
  expectStatus,
  publishByPayment,
  seedPaidExtension,
} from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const DAY = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Pagamentos e arrependimento (RN02 a RN05, RN07 e RN08) pela API e pelo
 * worker, com o adaptador local: o pedido muda o site na hora; o estorno sai
 * por job e é confirmado (ou recusado) pela rota dev. As extensões são semeadas
 * no banco (o pagamento de extensão entra no PR do ciclo de vida).
 */
describe('Pagamentos e arrependimento (RN02 a RN08; banco real)', () => {
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
    const marcos = await signedInUser({ app, name: 'Marcos Lima' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    const { paymentId } = await publishByPayment({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate,
    });
    return { ana, marcos, juliana, weddingId, paymentId };
  }

  const refund = (cookie: string, weddingId: string, paymentId: string, body: object = {}) =>
    request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments/${paymentId}/refund-request`)
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .send(body);

  const payment = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });
  const wedding = (id: string) => db.wedding.findUniqueOrThrow({ where: { id } });

  /** O job de estorno roda no worker: espera a tentativa. */
  async function attempted(paymentId: string, attempts = 1) {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const row = await payment(paymentId);
      if (row.refundAttempts >= attempts) return row;
      if (Date.now() > deadline) throw new Error(`Sem a tentativa ${attempts} de ${paymentId}.`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  const seedExtension = (args: {
    weddingId: string;
    ownerId: string;
    periodStart: string;
    periodEnd: string;
    paidAt?: Date;
  }) => seedPaidExtension({ db, gateway, ...args });

  it('RN02, RN03 e RN07 - desistir da publicação: rascunho no pedido; o estorno confirmado avisa', async () => {
    const { ana, weddingId, paymentId } = await published();

    const billing = await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(billing.body.payments[0].refundableUntil).toEqual(expect.any(String));

    const response = expectStatus(
      await refund(ana.cookie, weddingId, paymentId, { reason: 'Decidimos adiar o casamento.' }),
      202,
    );
    expect(response.body).toEqual({ status: 'refund_requested', refundsPaymentIds: [paymentId] });
    expect(await wedding(weddingId)).toMatchObject({
      status: 'draft',
      endDate: null,
      paidThrough: null,
    });
    expect((await wedding(weddingId)).publishedAt).not.toBeNull();
    expect(await payment(paymentId)).toMatchObject({
      status: 'refund_requested',
      refundOrigin: 'couple',
      refundRequestedByUserId: ana.userId,
      refundReason: 'Decidimos adiar o casamento.',
    });
    expect(
      await db.applicationLog.count({
        where: { entityId: paymentId, action: 'payment.refund_requested' },
      }),
    ).toBe(1);

    await attempted(paymentId);
    expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund' }), 200);
    const refunded = await payment(paymentId);
    expect(refunded.status).toBe('refunded');
    expect(refunded.refundedAt).not.toBeNull();
    const notice = await db.notification.findFirstOrThrow({
      where: { weddingId, userId: ana.userId, groupKey: `billing:${paymentId}:refund` },
    });
    expect(notice.payload).toEqual([
      expect.objectContaining({ kind: 'refund_completed', paymentId, cardLast4: '4242' }),
    ]);
    const emails = await waitForInbox({ to: ana.email, count: 2 });
    expect(emails.map((email) => email.Subject)).toContain('Reembolso concluído');
  });

  it('RN02 - fora do prazo: REFUND_WINDOW_CLOSED com o último instante, e o GET sem refundableUntil', async () => {
    const { ana, weddingId, paymentId } = await published();
    await db.payment.update({
      where: { id: paymentId },
      data: { paidAt: new Date(Date.now() - 9 * DAY) },
    });
    const response = expectStatus(await refund(ana.cookie, weddingId, paymentId), 409);
    expect(response.body).toMatchObject({
      error: 'REFUND_WINDOW_CLOSED',
      refundableUntil: expect.any(String),
    });
    expect(Date.parse(response.body.refundableUntil as string)).toBeLessThan(Date.now());
    const billing = await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(billing.body.payments[0].refundableUntil).toBeNull();
    expect((await wedding(weddingId)).status).toBe('published');
  });

  it('RN02 (risco 3) - o prazo segue o fuso do casamento: Manaus termina uma hora depois de São Paulo', async () => {
    const { ana, weddingId, paymentId } = await published();
    // Ontem às 03h30 UTC: 23h30 de anteontem em Manaus, 00h30 de ontem em São Paulo.
    const yesterday = new Date(Date.now() - DAY).toISOString().slice(0, 10);
    const paidAt = new Date(`${yesterday}T03:30:00Z`);
    await db.payment.update({ where: { id: paymentId }, data: { paidAt } });
    await db.wedding.update({
      where: { id: weddingId },
      data: { state: 'AM', timezone: 'America/Manaus' },
    });
    const manausDay = new Date(paidAt.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
    // Fim do 7º dia em Manaus: o dia do pagamento + 8, à meia-noite (UTC−4), menos 1 ms.
    const expected = new Date(Date.parse(`${manausDay}T04:00:00Z`) + 8 * DAY - 1);
    const billing = await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', ana.cookie)
      .expect(200);
    expect(billing.body.payments[0].refundableUntil).toBe(expected.toISOString());
  });

  it('RN03 - desistir da publicação leva a extensão paga por cima, cada uma com o seu estorno', async () => {
    const { ana, weddingId, paymentId } = await published();
    const extensionId = await seedExtension({
      weddingId,
      ownerId: ana.userId,
      periodStart: endDate,
      periodEnd: addMonths({ day: endDate, months: 3 }),
    });

    const response = expectStatus(await refund(ana.cookie, weddingId, paymentId), 202);
    expect([...(response.body.refundsPaymentIds as string[])].sort()).toEqual(
      [paymentId, extensionId].sort(),
    );
    expect(await payment(extensionId)).toMatchObject({ status: 'refund_requested' });
    expect(await wedding(weddingId)).toMatchObject({ status: 'draft', endDate: null });
    await attempted(paymentId);
    await attempted(extensionId);
    // N estornos independentes: o da extensão confirma, o da publicação ainda não.
    expectStatus(await devPaymentEvent({ app, paymentId: extensionId, event: 'refund' }), 200);
    expect(await payment(extensionId)).toMatchObject({ status: 'refunded' });
    expect(await payment(paymentId)).toMatchObject({ status: 'refund_requested' });
  });

  it('RN03 (B3-5) - desistir da extensão volta a data e o paidThrough aos anteriores', async () => {
    const { ana, weddingId } = await published();
    const extensionEnd = addMonths({ day: endDate, months: 3 });
    const extensionId = await seedExtension({
      weddingId,
      ownerId: ana.userId,
      periodStart: endDate,
      periodEnd: extensionEnd,
    });
    expectStatus(await refund(ana.cookie, weddingId, extensionId), 202);
    const back = await wedding(weddingId);
    expect(back.status).toBe('published');
    expect(back.endDate).toEqual(day(endDate));
    expect(back.paidThrough).toEqual(day(endDate));
  });

  it('RN03 - só a última extensão: a anterior, e a que tem cortesia depois, recebem REFUND_NOT_LAST_EXTENSION', async () => {
    const { ana, weddingId } = await published();
    const firstEnd = addMonths({ day: endDate, months: 3 });
    const first = await seedExtension({
      weddingId,
      ownerId: ana.userId,
      periodStart: endDate,
      periodEnd: firstEnd,
    });
    const secondEnd = addMonths({ day: firstEnd, months: 1 });
    const second = await seedExtension({
      weddingId,
      ownerId: ana.userId,
      periodStart: firstEnd,
      periodEnd: secondEnd,
    });
    const refused = expectStatus(await refund(ana.cookie, weddingId, first), 409);
    expect(refused.body).toMatchObject({ error: 'REFUND_NOT_LAST_EXTENSION' });

    // Uma cortesia do Admin depois da segunda a torna não-última.
    await db.courtesyExtension.create({
      data: {
        weddingId,
        months: 1,
        reason: 'Cortesia de teste',
        previousEndDate: day(secondEnd),
        newEndDate: day(addMonths({ day: secondEnd, months: 1 })),
        periodStart: day(secondEnd),
        periodEnd: day(addMonths({ day: secondEnd, months: 1 })),
      },
    });
    const courtesy = expectStatus(await refund(ana.cookie, weddingId, second), 409);
    expect(courtesy.body).toMatchObject({ error: 'REFUND_NOT_LAST_EXTENSION' });
  });

  it('RN04 - dois donos pedem juntos: um segue, o outro REFUND_ALREADY_REQUESTED, e o gateway recebe um estorno só', async () => {
    const { ana, marcos, weddingId, paymentId } = await published();
    const [first, second] = await Promise.all([
      refund(ana.cookie, weddingId, paymentId),
      refund(marcos.cookie, weddingId, paymentId),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    expect((first.status === 409 ? first : second).body).toMatchObject({
      error: 'REFUND_ALREADY_REQUESTED',
    });
    await attempted(paymentId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await payment(paymentId)).refundAttempts).toBe(1);
  });

  it('RN05 (B3-1 e B3-2) - o estorno recusado na 1ª chamada e nas 3 tentativas fica em refund_requested, com o alerta', async () => {
    const { ana, weddingId, paymentId } = await published();
    expectStatus(await refund(ana.cookie, weddingId, paymentId), 202);
    await attempted(paymentId);
    expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund-failed' }), 200);
    expect(await payment(paymentId)).toMatchObject({
      status: 'refund_requested',
      refundLastError: 'refund_refused',
      refundFailedAt: null,
    });

    // As tentativas de 1 h, 6 h e 24 h, pelo caso de uso do worker (relógio injetado).
    const process = worker.get(ProcessRefund);
    for (const attempt of [2, 3, 4]) {
      expect(await process.execute({ paymentId, now: new Date() })).toBe('requested');
      expect((await payment(paymentId)).refundAttempts).toBe(attempt);
      expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund-failed' }), 200);
    }
    const failed = await payment(paymentId);
    expect(failed.status).toBe('refund_requested');
    expect(failed.refundFailedAt).not.toBeNull();
    expect(await process.execute({ paymentId, now: new Date() })).toBe('given_up');
    const alert = await db.alert.findFirstOrThrow({
      where: { type: 'refund_failed', entityId: paymentId, status: 'open' },
    });
    expect(alert.data).toMatchObject({ attempts: 4, error: 'refund_refused' });
    expect(
      await db.applicationLog.count({
        where: { entityId: paymentId, action: 'payment.refund_failed' },
      }),
    ).toBe(4);
  });

  it('RN04 - a chamada sem resposta: a tentativa seguinte consulta antes e aplica o estorno que o gateway já fez', async () => {
    const { ana, weddingId, paymentId } = await published();
    // A falha programada só desta cobrança (as suítes em paralelo não a consomem).
    await gateway.failNextCalls({ count: 1, scope: paymentId });
    expectStatus(await refund(ana.cookie, weddingId, paymentId), 202);
    const first = await attempted(paymentId);
    expect(first.refundLastError).toBe('gateway_unavailable');

    const charge = await gateway.chargeByReference({ externalReference: paymentId });
    await gateway.updateCharge({ id: charge!.id, status: 'refunded' });
    expect(await worker.get(ProcessRefund).execute({ paymentId, now: new Date() })).toBe(
      'already_refunded',
    );
    expect(await payment(paymentId)).toMatchObject({ status: 'refunded', refundAttempts: 2 });
  });

  it('RN08 - o 2º reembolso de publicação do casamento abre o repeated_refund', async () => {
    const { ana, weddingId, paymentId } = await published();
    expectStatus(await refund(ana.cookie, weddingId, paymentId), 202);
    await attempted(paymentId);
    expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund' }), 200);

    const again = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    expectStatus(await refund(ana.cookie, weddingId, again.paymentId), 202);
    expect(
      await db.alert.count({
        where: { type: 'repeated_refund', entityId: again.paymentId, status: 'open' },
      }),
    ).toBe(1);
  });

  it('Publicar e pagar RN08 - o pago sem destino vira estorno automático e avisa quando conclui', async () => {
    const { ana, weddingId } = await published();
    // Um pagamento cancelado (o Pix trocado) que o gateway confirma depois.
    const customerId = await gateway.createCustomer({ name: 'Ana', taxIdLast4: '4725' });
    const applied = await db.payment.findFirstOrThrow({ where: { weddingId } });
    const orphanId = randomUUID();
    await db.payment.create({
      data: {
        ...applied,
        id: orphanId,
        externalReference: orphanId,
        idempotencyKey: randomUUID(),
        status: 'canceled',
        shortCode: undefined,
        gatewayPaymentId: null,
        paidAt: null,
        appliedAt: null,
        gatewayChargedCents: null,
        gatewayFeeCents: null,
        netCents: null,
        canceledAt: new Date(),
        createdAt: undefined,
        updatedAt: undefined,
      },
    });
    await gateway.createCharge({
      externalReference: orphanId,
      customerId,
      method: 'card',
      amountCents: applied.amountCents,
      installments: applied.installments,
      status: 'canceled',
      pixCopyPaste: null,
      dueAt: null,
      cardLast4: null,
      failureReason: null,
    });

    expectStatus(await devPaymentEvent({ app, paymentId: orphanId, event: 'confirm' }), 200);
    expect(await payment(orphanId)).toMatchObject({
      status: 'refund_requested',
      refundOrigin: 'automatic',
      appliedAt: null,
    });
    await attempted(orphanId);
    expectStatus(await devPaymentEvent({ app, paymentId: orphanId, event: 'refund' }), 200);
    expect(await payment(orphanId)).toMatchObject({ status: 'refunded' });
    expect(
      await db.notification.count({
        where: { weddingId, userId: ana.userId, groupKey: `billing:${orphanId}:refund` },
      }),
    ).toBe(1);
    expect((await wedding(weddingId)).status).toBe('published');
  });

  it('RN02 a RN04 (isolamento) - o pagamento de outro casamento da mesma dona, pela URL de um rascunho: 404, e o outro fica intocado', async () => {
    const { ana, weddingId: weddingA, paymentId } = await published();
    const { weddingId: weddingB } = await seedWedding({ db, ownerId: ana.userId });

    const response = expectStatus(await refund(ana.cookie, weddingB, paymentId), 404);
    expect(response.body).toMatchObject({ error: 'PAYMENT_NOT_FOUND' });
    expect(await wedding(weddingA)).toMatchObject({ status: 'published' });
    expect(await payment(paymentId)).toMatchObject({ status: 'paid', refundOrigin: null });
  });

  it('RN02 - recusas: colaboradora, pendente, contestado, bloqueado e pagamento de outro casamento', async () => {
    const { ana, juliana, weddingId, paymentId } = await published();
    const other = await published();

    const collaborator = expectStatus(await refund(juliana.cookie, weddingId, paymentId), 403);
    expect(collaborator.body).toMatchObject({ error: 'ACTION_NOT_ALLOWED' });
    const foreign = expectStatus(await refund(ana.cookie, weddingId, other.paymentId), 404);
    expect(foreign.body).toMatchObject({ error: 'PAYMENT_NOT_FOUND' });
    const invalid = expectStatus(await refund(ana.cookie, weddingId, 'x'), 400);
    expect(invalid.body.errors).toEqual([expect.objectContaining({ path: 'paymentId' })]);
    expectStatus(await refund(ana.cookie, weddingId, paymentId, { reason: null }), 400);

    await db.payment.update({
      where: { id: paymentId },
      data: { status: 'disputed', disputedAt: new Date() },
    });
    const disputed = expectStatus(await refund(ana.cookie, weddingId, paymentId), 409);
    expect(disputed.body).toMatchObject({ error: 'PAYMENT_DISPUTED' });

    await db.payment.update({ where: { id: paymentId }, data: { status: 'paid' } });
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: new Date() } });
    const blocked = expectStatus(await refund(ana.cookie, weddingId, paymentId), 403);
    expect(blocked.body).toMatchObject({ error: 'WEDDING_BLOCKED' });
    await db.wedding.update({ where: { id: weddingId }, data: { blockedAt: null } });

    // Pago e não aplicado (o sem destino) não tem Desistir.
    await db.payment.update({ where: { id: paymentId }, data: { appliedAt: null } });
    const notPaid = expectStatus(await refund(ana.cookie, weddingId, paymentId), 409);
    expect(notPaid.body).toMatchObject({ error: 'PAYMENT_NOT_PAID' });
  });
});
