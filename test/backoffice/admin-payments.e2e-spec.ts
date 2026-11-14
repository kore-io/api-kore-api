import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import {
  devPaymentEvent,
  expectStatus,
  payForExtension,
  payForPublication,
  publishByPayment,
} from '../support/payments';
import { signedInUser, staffUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
const DAY_MS = 86_400_000;
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const plus = (value: string, days: number) =>
  new Date(day(value).getTime() + days * DAY_MS).toISOString().slice(0, 10);

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
 * A Cobrança do Backoffice (Backoffice - cobrança RN01 a RN07 e RN11): lista,
 * detalhe, aba do casamento, Reembolsar, cortesia, CSV e as ações dos alertas.
 */
describe('Backoffice: Cobrança (Backoffice - cobrança RN02 a RN07 e RN11; banco real)', () => {
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

  const http = () => request(app.getHttpServer());
  const post = (cookie: string, path: string, body: Record<string, unknown> = {}) =>
    http().post(`/v1/admin${path}`).set('Cookie', cookie).set('Origin', ORIGIN).send(body);
  const get = (cookie: string, path: string, query: Record<string, string> = {}) =>
    http().get(`/v1/admin${path}`).query(query).set('Cookie', cookie);

  /** Ana publicou e pagou há `paidDaysAgo` dias (fora do prazo de 7 dias do casal). */
  async function paid({ paidDaysAgo = 20 }: { paidDaysAgo?: number } = {}) {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({ where: { id: weddingId }, data: { eventDate: day(eventDate) } });
    const { paymentId } = await publishByPayment({ app, cookie: ana.cookie, weddingId, endDate });
    await db.payment.update({
      where: { id: paymentId },
      data: { paidAt: new Date(Date.now() - paidDaysAgo * DAY_MS) },
    });
    return { ana, weddingId, paymentId };
  }

  it('RN05 - o Admin reembolsa a qualquer momento: integral, o site volta a rascunho, o motivo no log e o estorno pelo job', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const support = await staffUser({ app, role: 'support' });
    const { weddingId, paymentId } = await paid();
    expect(
      (await post(support.cookie, `/payments/${paymentId}/refund`).expect(403)).body.error,
    ).toBe('ACTION_NOT_ALLOWED');

    const response = await post(admin.cookie, `/payments/${paymentId}/refund`, {
      reason: 'Casal pediu pelo suporte.',
    }).expect(202);
    // Cartão: o prazo do gateway não está confirmado, então não passa (decisão 259(2)).
    expect(response.body).toEqual({
      status: 'refund_requested',
      refundsPaymentIds: [paymentId],
      pastGatewayWindow: false,
    });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      refundOrigin: 'admin',
      refundRequestedByUserId: admin.userId,
      refundReason: null,
    });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('draft');
    const log = await db.applicationLog.findFirstOrThrow({
      where: { action: 'payment.refund_requested', entityId: paymentId },
    });
    expect(log).toMatchObject({
      actorUserId: admin.userId,
      data: expect.objectContaining({ refundOrigin: 'admin', reason: 'Casal pediu pelo suporte.' }),
    });
    // O gateway local confirma o estorno pelo evento (Pagamentos e arrependimento RN04).
    expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund' }), 200);
    const detail = await get(admin.cookie, `/payments/${paymentId}`).expect(200);
    expect(detail.body).toMatchObject({
      id: paymentId,
      code: expect.stringMatching(/^P-\d{4,}$/),
      status: 'refunded',
      payerTaxIdLast4: '4725',
      refund: { origin: 'admin', reason: 'Casal pediu pelo suporte.' },
    });
    expect((await post(admin.cookie, `/payments/${paymentId}/refund`).expect(409)).body.error).toBe(
      'REFUND_ALREADY_REQUESTED',
    );
  });

  it('RN05 - em contestação, o Reembolsar é recusado', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { paymentId } = await paid();
    await db.payment.update({
      where: { id: paymentId },
      data: { status: 'disputed', disputedAt: new Date(), disputeDeadline: day(eventDate) },
    });
    expect((await post(admin.cookie, `/payments/${paymentId}/refund`).expect(409)).body.error).toBe(
      'PAYMENT_DISPUTED',
    );
  });

  it('RN06 - Estender como cortesia: a nova data e o paidThrough, sem Payment nem comissão, o aviso ao casal e o log', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { weddingId } = await paid();
    const newEnd = addMonths({ day: endDate, months: 3 });
    expect(
      (
        await post(admin.cookie, `/weddings/${weddingId}/courtesy`, {
          months: 3,
          reason: 'Compensação do bloqueio.',
        }).expect(200)
      ).body,
    ).toEqual({ previousEndDate: endDate, newEndDate: newEnd, canceledPaymentId: null });
    expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
      endDate: day(newEnd),
      paidThrough: day(newEnd),
    });
    expect(
      await db.courtesyExtension.count({ where: { weddingId, adminUserId: admin.userId } }),
    ).toBe(1);
    expect(await db.payment.count({ where: { weddingId } })).toBe(1);
    const [notice] = await db.notification.findMany({
      where: { weddingId, type: 'billing', groupKey: `billing:courtesy:${newEnd}` },
    });
    expect(notice.payload).toEqual([
      expect.objectContaining({ kind: 'courtesy', endDate: newEnd }),
    ]);
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'wedding.courtesy_extended', weddingId },
    });

    // Até 12 meses depois do casamento (decisão 39).
    expect(
      (
        await post(admin.cookie, `/weddings/${weddingId}/courtesy`, {
          months: 12,
          reason: 'Passa do limite.',
        }).expect(422)
      ).body.error,
    ).toBe('END_DATE_OUT_OF_RANGE');

    // A aba Cobrança do casamento: os pagamentos com a comissão e a cortesia.
    const billing = await get(admin.cookie, `/weddings/${weddingId}`, { tab: 'billing' }).expect(
      200,
    );
    expect(billing.body.billing.courtesies).toEqual([
      expect.objectContaining({ months: 3, newEndDate: newEnd }),
    ]);
    expect(billing.body.billing.payments).toHaveLength(1);
    const support = await staffUser({ app, role: 'support' });
    await get(support.cookie, `/weddings/${weddingId}`, { tab: 'billing' }).expect(403);
  });

  for (const state of ['grace', 'expired'] as const)
    it(`RN05 - o Reembolsar da publicação em ${state === 'grace' ? 'carência' : 'expirado'} volta a rascunho sem o ciclo, e o casal publica de novo`, async () => {
      const admin = await staffUser({ app, role: 'admin' });
      const { ana, weddingId, paymentId } = await paid({ paidDaysAgo: 90 });
      const event = plus(today, -60);
      const end = state === 'grace' ? plus(today, -2) : plus(today, -30);
      await db.wedding.update({
        where: { id: weddingId },
        data: {
          status: state,
          eventDate: day(event),
          endDate: day(end),
          paidThrough: day(end),
          graceUntil: day(plus(end, 7)),
          ...(state === 'expired'
            ? {
                expiredAt: day(plus(end, 8)),
                purgeAt: day(addMonths({ day: plus(end, 8), months: 6 })),
              }
            : {}),
        },
      });
      await post(admin.cookie, `/payments/${paymentId}/refund`, {
        reason: 'Casal pediu depois do prazo.',
      }).expect(202);
      expect(await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).toMatchObject({
        status: 'draft',
        endDate: null,
        graceUntil: null,
        expiredAt: null,
        purgeAt: null,
        purgeNoticeSentAt: null,
      });
      expectStatus(await devPaymentEvent({ app, paymentId, event: 'refund' }), 200);
      const again = await payForPublication({
        app,
        cookie: ana.cookie,
        weddingId,
        endDate: addMonths({ day: today, months: 3 }),
      });
      expectStatus(again, 201);
      expectStatus(
        await devPaymentEvent({ app, paymentId: again.body.paymentId as string, event: 'confirm' }),
        200,
      );
      expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
        'published',
      );
    });

  it('RN06 (B10-5) - a cortesia cancela o Pix de extensão aberto', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { ana, weddingId } = await paid();
    const pix = await payForExtension({
      app,
      cookie: ana.cookie,
      weddingId,
      endDate: addMonths({ day: endDate, months: 3 }),
      method: 'pix',
    });
    expectStatus(pix, 201);
    const pendingId = pix.body.paymentId as string;
    expect((await db.payment.findUniqueOrThrow({ where: { id: pendingId } })).status).toBe(
      'pending',
    );
    const response = await post(admin.cookie, `/weddings/${weddingId}/courtesy`, {
      months: 1,
      reason: 'Compensação do bloqueio.',
    }).expect(200);
    expect(response.body.canceledPaymentId).toBe(pendingId);
    await until(
      () => db.payment.findUniqueOrThrow({ where: { id: pendingId } }),
      (payment) => payment.status === 'canceled',
    );
  });

  it('RN07 - o CSV do período: o pagamento, o código e o log da exportação', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    const { paymentId } = await paid({ paidDaysAgo: 1 });
    const { shortCode } = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const from = new Date(Date.now() - 2 * DAY_MS).toISOString();
    const to = new Date().toISOString();
    const response = await get(admin.cookie, '/payments/export', { from, to }).expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/csv/);
    const text = response.text ?? Buffer.from(response.body as Buffer).toString('utf8');
    expect(text).toContain(`P-${String(shortCode).padStart(4, '0')}`);
    expect(text).not.toContain('529.982.247-25');
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'payments.exported', actorUserId: admin.userId },
    });
  });

  it('RN11 - Aplicar mesmo assim, Tentar o estorno de novo e Registrar reembolso feito por fora', async () => {
    const admin = await staffUser({ app, role: 'admin' });
    // O valor menor no gateway: pago e não aplicado, com o alerta.
    const mismatch = await paid();
    await db.wedding.update({
      where: { id: mismatch.weddingId },
      data: { status: 'draft', endDate: null, paidThrough: null, publicationSource: null },
    });
    await db.commission.deleteMany({ where: { paymentId: mismatch.paymentId } });
    await db.payment.update({ where: { id: mismatch.paymentId }, data: { appliedAt: null } });
    // Sem o alerta aberto, 409 PAYMENT_NOT_MISMATCHED (Contrato de API).
    expect(
      (
        await post(admin.cookie, `/payments/${mismatch.paymentId}/apply`, {
          reason: 'Sem alerta nenhum aberto.',
        }).expect(409)
      ).body.error,
    ).toBe('PAYMENT_NOT_MISMATCHED');
    await db.alert.create({
      data: {
        type: 'gateway_amount_mismatch',
        weddingId: mismatch.weddingId,
        entityType: 'payment',
        entityId: mismatch.paymentId,
        data: {},
      },
    });
    await post(admin.cookie, `/payments/${mismatch.paymentId}/apply`, {
      reason: 'Diferença de centavos.',
    }).expect(200);
    expect((await db.wedding.findUniqueOrThrow({ where: { id: mismatch.weddingId } })).status).toBe(
      'published',
    );
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: mismatch.paymentId } })).appliedByAdminAt,
    ).toEqual(expect.any(Date));
    expect(
      await db.alert.count({
        where: { entityId: mismatch.paymentId, status: 'open', type: 'gateway_amount_mismatch' },
      }),
    ).toBe(0);
    expect(
      (
        await post(admin.cookie, `/payments/${mismatch.paymentId}/apply`, {
          reason: 'De novo, por engano.',
        }).expect(409)
      ).body.error,
    ).toBe('PAYMENT_NOT_MISMATCHED');

    // O estorno que falhou: Tentar de novo tira a desistência e chama o job.
    const failed = await paid();
    await db.payment.update({
      where: { id: failed.paymentId },
      data: {
        status: 'refund_requested',
        refundOrigin: 'couple',
        refundRequestedAt: new Date(),
        refundAttempts: 4,
        refundLastError: 'refused',
        refundFailedAt: new Date(),
      },
    });
    await post(admin.cookie, `/payments/${failed.paymentId}/refund/retry`, {
      reason: 'O Asaas voltou.',
    }).expect(202);
    // Já sem a falha: 409 REFUND_NOT_FAILED.
    expect(
      (
        await post(admin.cookie, `/payments/${failed.paymentId}/refund/retry`, {
          reason: 'De novo, por engano.',
        }).expect(409)
      ).body.error,
    ).toBe('REFUND_NOT_FAILED');
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'payment.refund_retried', entityId: failed.paymentId },
    });

    // Reembolso feito por fora: refunded, origem manual, com o comprovante, sem gateway.
    const outside = await paid();
    await db.payment.update({
      where: { id: outside.paymentId },
      data: {
        status: 'refund_requested',
        refundOrigin: 'couple',
        refundRequestedAt: new Date(),
        refundFailedAt: new Date(),
      },
    });
    // Decisão 262: com o estorno do gateway ainda correndo, 409 REFUND_NOT_FAILED.
    const running = await paid();
    await db.payment.update({
      where: { id: running.paymentId },
      data: { status: 'refund_requested', refundOrigin: 'couple', refundRequestedAt: new Date() },
    });
    const early = [
      [
        'refund/manual',
        {
          reason: 'Pix devolvido pelo banco.',
          receipt: `refund-receipts/${running.paymentId}/${'a'.repeat(32)}.pdf`,
        },
      ],
      ['refund/receipt-upload', { contentType: 'application/pdf', sizeBytes: 100 }],
    ] as const;
    for (const [path, body] of early)
      expect(
        (await post(admin.cookie, `/payments/${running.paymentId}/${path}`, body).expect(409)).body
          .error,
      ).toBe('REFUND_NOT_FAILED');
    // O comprovante sobe pela URL pré-assinada (decisão 259(1)); sem ele, 422.
    expect(
      (
        await post(admin.cookie, `/payments/${outside.paymentId}/refund/manual`, {
          reason: 'Pix devolvido pelo banco.',
          receipt: `refund-receipts/${randomUUID()}/x.pdf`,
        }).expect(422)
      ).body.error,
    ).toBe('REFUND_RECEIPT_MISSING');
    const pdf = Buffer.from('%PDF-1.4 comprovante');
    const upload = await post(
      admin.cookie,
      `/payments/${outside.paymentId}/refund/receipt-upload`,
      {
        contentType: 'application/pdf',
        sizeBytes: pdf.length,
      },
    ).expect(201);
    expect(upload.body.receiptKey).toMatch(new RegExp(`^refund-receipts/${outside.paymentId}/`));
    const put = await fetch(upload.body.url as string, {
      method: 'PUT',
      body: new Uint8Array(pdf),
      headers: { 'Content-Type': 'application/pdf' },
    });
    expect(put.status).toBe(200);
    await post(admin.cookie, `/payments/${outside.paymentId}/refund/manual`, {
      reason: 'Pix devolvido pelo banco.',
      receipt: upload.body.receiptKey,
    }).expect(200);
    // Só o Admin lê o comprovante, pela API.
    const file = await get(admin.cookie, `/payments/${outside.paymentId}/refund/receipt`)
      .buffer(true)
      .expect(200);
    expect(file.headers['content-type']).toMatch(/^application\/pdf/);
    expect(Buffer.from(file.body as Buffer).toString()).toBe(pdf.toString());
    const support = await staffUser({ app, role: 'support' });
    await get(support.cookie, `/payments/${outside.paymentId}/refund/receipt`).expect(403);
    expect(await db.payment.findUniqueOrThrow({ where: { id: outside.paymentId } })).toMatchObject({
      status: 'refunded',
      refundOrigin: 'manual',
      refundedOutsideGateway: true,
      refundReceiptKey: upload.body.receiptKey,
    });
    await db.applicationLog.findFirstOrThrow({
      where: { action: 'payment.refund_recorded_manually', entityId: outside.paymentId },
    });
  });
});
