import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ReconcilePayments } from '../../src/modules/billing/application/reconcile-payments.use-case';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { inbox, waitForInbox } from '../support/mailpit';
import { expectStatus, payForPublication, type PayArgs } from '../support/payments';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * A reconciliação e a troca do pendente (Publicar e pagar RN07 e RN11), com o
 * adaptador local no Postgres. As rotinas rodam pelo caso de uso do worker,
 * com o relógio injetado (RN21) e recortadas ao casamento do teste (o
 * kore_test é compartilhado). "Pago sem webhook" muda a cobrança direto no
 * gateway local, sem disparar o evento.
 */
describe('Reconciliação e troca do pendente (Publicar e pagar RN07 e RN11; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let gateway: LocalGatewayStore;
  let reconcile: ReconcilePayments;
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    gateway = app.get(LocalGatewayStore);
    reconcile = worker.get(ReconcilePayments);
    // Sem a falha programada do gateway local (failNextCalls): ela é global no
    // banco e as suítes de cobrança rodam em paralelo.
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  async function scenario() {
    const ana = await signedInUser({ app });
    const { weddingId } = await seedWedding({ db, ownerId: ana.userId });
    await db.wedding.update({
      where: { id: weddingId },
      data: { eventDate: new Date(`${eventDate}T00:00:00Z`) },
    });
    return { ana, weddingId };
  }

  const pay = (args: Omit<PayArgs, 'app' | 'endDate'>) =>
    payForPublication({ app, endDate, ...args });

  /** O gateway recebeu, mas o webhook não chegou. */
  async function paidWithoutWebhook(paymentId: string) {
    const charge = await gateway.chargeByReference({ externalReference: paymentId });
    if (!charge) throw new Error('Sem cobrança no gateway local.');
    await gateway.updateCharge({
      id: charge.id,
      status: 'confirmed',
      chargedCents: charge.amount_cents,
    });
  }

  const payment = (id: string) => db.payment.findUniqueOrThrow({ where: { id } });
  const weddingStatus = async (id: string) =>
    (await db.wedding.findUniqueOrThrow({ where: { id } })).status;
  const later = (ms: number) => new Date(Date.now() + ms);

  describe('rodada de 10 minutos', () => {
    it('RN11 (B2-1) - o pedido caiu antes da cobrança: sem cobrança no gateway, o pendente fica cancelado', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(await pay({ cookie: ana.cookie, weddingId }), 201);
      const paymentId = created.body.paymentId as string;
      // O pedido caiu entre o passo 1 e o passo 2: nada no gateway, nada do passo 3.
      await db.$executeRawUnsafe(
        'DELETE FROM local_gateway.charges WHERE external_reference = $1',
        paymentId,
      );
      await db.payment.update({ where: { id: paymentId }, data: { gatewayPaymentId: null } });

      // Antes dos 5 minutos, a rodada não mexe: o pedido pode estar em curso.
      await reconcile.pending({ now: new Date(), weddingId });
      expect(await payment(paymentId)).toMatchObject({ status: 'pending' });

      const tally = await reconcile.pending({ now: later(6 * MINUTE), weddingId });
      expect(tally).toMatchObject({ checked: 1, changed: 1, errors: 0 });
      expect(await payment(paymentId)).toMatchObject({
        status: 'canceled',
        gatewayPaymentId: null,
      });
      const log = await db.applicationLog.findFirstOrThrow({
        where: { entityId: paymentId, action: 'payment.canceled' },
      });
      expect(log.data).toEqual({ reason: 'no_gateway_charge' });
    });

    it('RN11 (B2-1) - a cobrança saiu e foi paga, mas a resposta e o webhook se perderam: a consulta pela referência aplica', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(await pay({ cookie: ana.cookie, weddingId }), 201);
      const paymentId = created.body.paymentId as string;
      // O passo 3 não gravou o id do gateway.
      await db.payment.update({ where: { id: paymentId }, data: { gatewayPaymentId: null } });
      await paidWithoutWebhook(paymentId);

      await reconcile.pending({ now: later(6 * MINUTE), weddingId });
      const paid = await payment(paymentId);
      expect(paid.status).toBe('paid');
      expect(paid.appliedAt).not.toBeNull();
      expect(paid.gatewayPaymentId).not.toBeNull();
      expect(await weddingStatus(weddingId)).toBe('published');
    });

    it('RN11 - Pix vencido e não pago: cancelado no Kore e no gateway, com o e-mail "O código Pix venceu"', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, method: 'pix' }),
        201,
      );
      const paymentId = created.body.paymentId as string;

      // Antes do vencimento, o Pix pendente continua pendente.
      await reconcile.pending({ now: later(23 * HOUR), weddingId });
      expect(await payment(paymentId)).toMatchObject({ status: 'pending' });

      await reconcile.pending({ now: later(24 * HOUR + 10 * MINUTE), weddingId });
      expect(await payment(paymentId)).toMatchObject({ status: 'canceled' });
      expect(await gateway.chargeByReference({ externalReference: paymentId })).toMatchObject({
        status: 'canceled',
      });
      expect(await weddingStatus(weddingId)).toBe('draft');
      const log = await db.applicationLog.findFirstOrThrow({
        where: { entityId: paymentId, action: 'payment.canceled' },
      });
      expect(log.data).toEqual({ reason: 'pix_expired' });

      const [email] = await waitForInbox({ to: ana.email });
      expect(email.Subject).toBe('O código Pix venceu');
      // A tela do Pix sai do pendente; o casal gera outro.
      const billing = await request(app.getHttpServer())
        .get(`/v1/weddings/${weddingId}/billing`)
        .set('Cookie', ana.cookie)
        .expect(200);
      expect(billing.body).toMatchObject({ pendingPayment: null, awaitingPayment: false });
    });

    it('RN11 - Pix vencido que o gateway diz pago: a rodada consulta antes de cancelar e publica', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, method: 'pix' }),
        201,
      );
      const paymentId = created.body.paymentId as string;
      await paidWithoutWebhook(paymentId);

      await reconcile.pending({ now: later(25 * HOUR), weddingId });
      const paid = await payment(paymentId);
      expect(paid.status).toBe('paid');
      expect(paid.appliedAt).not.toBeNull();
      expect(await weddingStatus(weddingId)).toBe('published');
      expect(
        await db.applicationLog.count({
          where: { entityId: paymentId, action: 'payment.canceled' },
        }),
      ).toBe(0);
    });

    it('RN11 - o cartão pendente não vence: continua pendente', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(await pay({ cookie: ana.cookie, weddingId }), 201);
      const tally = await reconcile.pending({ now: later(25 * HOUR), weddingId });
      expect(tally).toMatchObject({ checked: 1, changed: 0 });
      expect(await payment(created.body.paymentId as string)).toMatchObject({ status: 'pending' });
    });
  });

  describe('trocar o pendente', () => {
    it('RN07 (B2-4) - Gerar novo Pix cancela o anterior no gateway e no Kore e cria outro, sem o e-mail de vencido', async () => {
      const { ana, weddingId } = await scenario();
      const first = expectStatus(await pay({ cookie: ana.cookie, weddingId, method: 'pix' }), 201);
      const firstId = first.body.paymentId as string;

      const second = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, method: 'pix', replacesPaymentId: firstId }),
        201,
      );
      const secondId = second.body.paymentId as string;
      expect(secondId).not.toBe(firstId);
      expect(second.body).toMatchObject({ status: 'pending', method: 'pix' });
      expect((second.body.pix as { copyPaste: string }).copyPaste).not.toBe(
        (first.body.pix as { copyPaste: string }).copyPaste,
      );

      expect(await payment(firstId)).toMatchObject({ status: 'canceled' });
      expect(await gateway.chargeByReference({ externalReference: firstId })).toMatchObject({
        status: 'canceled',
      });
      expect(await payment(secondId)).toMatchObject({
        status: 'pending',
        replacesPaymentId: firstId,
      });
      const log = await db.applicationLog.findFirstOrThrow({
        where: { entityId: firstId, action: 'payment.canceled' },
      });
      expect(log.data).toEqual({ reason: 'replaced' });
      expect(await inbox({ to: ana.email })).toHaveLength(0);
    });

    it('RN07 (B2-4) - trocar o Pix pelo cartão', async () => {
      const { ana, weddingId } = await scenario();
      const pix = expectStatus(await pay({ cookie: ana.cookie, weddingId, method: 'pix' }), 201);
      const card = expectStatus(
        await pay({
          cookie: ana.cookie,
          weddingId,
          replacesPaymentId: pix.body.paymentId as string,
        }),
        201,
      );
      expect(card.body).toMatchObject({ status: 'pending', method: 'card' });
      expect(await payment(pix.body.paymentId as string)).toMatchObject({ status: 'canceled' });
    });

    it('RN07 (B2-4) - o Pix anterior já foi pago: o Kore aplica e responde PAYMENT_ALREADY_PAID, sem criar outro', async () => {
      const { ana, weddingId } = await scenario();
      const pix = expectStatus(await pay({ cookie: ana.cookie, weddingId, method: 'pix' }), 201);
      const pixId = pix.body.paymentId as string;
      await paidWithoutWebhook(pixId);

      const response = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, method: 'pix', replacesPaymentId: pixId }),
        409,
      );
      expect(response.body).toMatchObject({ error: 'PAYMENT_ALREADY_PAID' });
      expect(await db.payment.count({ where: { weddingId } })).toBe(1);
      expect((await payment(pixId)).appliedAt).not.toBeNull();
      expect(await weddingStatus(weddingId)).toBe('published');
    });

    it('RN07 - repetir o pedido de troca com a mesma chave devolve o mesmo pagamento novo', async () => {
      const { ana, weddingId } = await scenario();
      const pix = expectStatus(await pay({ cookie: ana.cookie, weddingId, method: 'pix' }), 201);
      const key = randomUUID();
      const args = {
        cookie: ana.cookie,
        weddingId,
        method: 'pix' as const,
        key,
        replacesPaymentId: pix.body.paymentId as string,
      };
      const first = expectStatus(await pay(args), 201);
      const again = expectStatus(await pay(args), 201);
      expect(again.body).toEqual(first.body);
      expect(await db.payment.count({ where: { weddingId } })).toBe(2);
    });

    it('RN07 - o pendente de outro casamento não é trocado nem gravado como anterior', async () => {
      const other = await scenario();
      const foreign = expectStatus(
        await pay({ cookie: other.ana.cookie, weddingId: other.weddingId, method: 'pix' }),
        201,
      );
      const foreignId = foreign.body.paymentId as string;
      const { ana, weddingId } = await scenario();

      const created = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, method: 'pix', replacesPaymentId: foreignId }),
        201,
      );
      expect(await payment(created.body.paymentId as string)).toMatchObject({
        status: 'pending',
        replacesPaymentId: null,
      });
      expect(await payment(foreignId)).toMatchObject({ status: 'pending' });
      expect(await gateway.chargeByReference({ externalReference: foreignId })).toMatchObject({
        status: 'pending',
      });
    });

    it('RN07 - o anterior que não existe: cria o novo sem vínculo (não 500)', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, replacesPaymentId: randomUUID() }),
        201,
      );
      expect(await payment(created.body.paymentId as string)).toMatchObject({
        status: 'pending',
        replacesPaymentId: null,
      });
    });

    it('RN07 - replacesPaymentId fora do formato UUID: 400', async () => {
      const { ana, weddingId } = await scenario();
      const response = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, overrides: { replacesPaymentId: 'x' } }),
        400,
      );
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'replacesPaymentId' })]),
      );
      expectStatus(
        await pay({ cookie: ana.cookie, weddingId, overrides: { replacesPaymentId: null } }),
        400,
      );
    });
  });

  describe('rodada diária', () => {
    it('RN11 - o pago que o gateway não confirma mais: alerta webhook_failure', async () => {
      const { ana, weddingId } = await scenario();
      const created = expectStatus(await pay({ cookie: ana.cookie, weddingId }), 201);
      const paymentId = created.body.paymentId as string;
      await paidWithoutWebhook(paymentId);
      await reconcile.pending({ now: later(6 * MINUTE), weddingId });
      expect(await payment(paymentId)).toMatchObject({ status: 'paid' });

      // Tudo certo: nenhum alerta.
      expect(await reconcile.settled({ now: new Date(), weddingId })).toMatchObject({
        checked: 1,
        alerts: 0,
      });

      const charge = await gateway.chargeByReference({ externalReference: paymentId });
      await gateway.updateCharge({ id: charge!.id, status: 'canceled' });
      expect(await reconcile.settled({ now: new Date(), weddingId })).toMatchObject({
        checked: 1,
        alerts: 1,
      });
      const alert = await db.alert.findFirstOrThrow({
        where: { type: 'webhook_failure', entityId: paymentId, status: 'open' },
      });
      expect(alert.data).toEqual({
        reason: 'state_mismatch',
        paymentStatus: 'paid',
        gatewayStatus: 'canceled',
      });
      // A rodada seguinte não abre outro.
      await reconcile.settled({ now: new Date(), weddingId });
      expect(
        await db.alert.count({ where: { type: 'webhook_failure', entityId: paymentId } }),
      ).toBe(1);
    });

    it('RN11 (B2-8) - a cobrança do gateway sem Payment: alerta', async () => {
      const reference = randomUUID();
      const customerId = await gateway.createCustomer({ name: 'Sem Payment', taxIdLast4: '0000' });
      const charge = await gateway.createCharge({
        externalReference: reference,
        customerId,
        method: 'pix',
        amountCents: 10_000,
        installments: 1,
        status: 'confirmed',
        pixCopyPaste: null,
        dueAt: null,
        cardLast4: null,
        failureReason: null,
      });
      await reconcile.gatewayList({ now: new Date() });
      const alert = await db.alert.findFirstOrThrow({
        where: { type: 'webhook_failure', entityType: 'gateway_charge', entityId: charge.id },
      });
      expect(alert).toMatchObject({ status: 'open', weddingId: null });
      expect(alert.data).toMatchObject({
        reason: 'charge_without_payment',
        externalReference: reference,
      });
    });

    it('RN08 e RN11 (B2-2) - o Pix trocado que o gateway recebeu sem webhook: a lista o acha, pago sem destino', async () => {
      const { ana, weddingId } = await scenario();
      const pix = expectStatus(await pay({ cookie: ana.cookie, weddingId, method: 'pix' }), 201);
      const pixId = pix.body.paymentId as string;
      const card = expectStatus(
        await pay({ cookie: ana.cookie, weddingId, replacesPaymentId: pixId }),
        201,
      );
      await paidWithoutWebhook(card.body.paymentId as string);
      await reconcile.pending({ now: later(6 * MINUTE), weddingId });
      expect(await weddingStatus(weddingId)).toBe('published');

      await paidWithoutWebhook(pixId);
      await reconcile.gatewayList({ now: new Date() });
      const orphan = await payment(pixId);
      expect(orphan.status).toBe('paid');
      expect(orphan.appliedAt).toBeNull();
      expect(
        await db.alert.count({
          where: { type: 'orphan_payment', entityId: pixId, status: 'open' },
        }),
      ).toBe(1);
    });
  });
});
