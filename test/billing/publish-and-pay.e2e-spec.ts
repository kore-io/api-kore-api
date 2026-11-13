import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../../src/modules/billing/application/ports/payment-gateway.port';
import { addMonths } from '../../src/modules/billing/domain/pricing';
import { LOCAL_WEBHOOK_TOKEN_HEADER } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-payment-gateway';
import { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { localDate } from '../../src/shared/time/local-date';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { waitForInbox } from '../support/mailpit';
import { seedReferrer } from '../support/referrers';
import { signedInUser } from '../support/sessions';
import { seedWedding } from '../support/weddings';

/**
 * Publicar e pagar (RN01 a RN12 e RN20) pela API, com o adaptador local no
 * Postgres e a confirmação pela rota dev, que processa em linha (RN21). As
 * datas são relativas a hoje (a rota usa o relógio do servidor).
 */
describe('Publicar e pagar (Publicar e pagar RN01 a RN12; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  const CPF = '529.982.247-25';
  const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';
  const CPF_DIGITS = '52998224725';
  const today = localDate({ at: new Date(), timezone: 'America/Sao_Paulo' });
  const eventDate = addMonths({ day: today, months: 4 });
  const endDate = addMonths({ day: eventDate, months: 3 });

  beforeAll(async () => {
    app = await createTestApp();
    // O e-mail sai pela fila: o worker entrega no Mailpit.
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  /** Ana e Marcos, donos; Juliana, colaboradora e indicadora (assessoria). */
  async function scenario() {
    const ana = await signedInUser({ app });
    const marcos = await signedInUser({ app, name: 'Marcos Lima' });
    const juliana = await signedInUser({ app, name: 'Juliana Prado' });
    const { weddingId } = await seedWedding({
      db,
      ownerId: ana.userId,
      collaboratorIds: [juliana.userId],
    });
    await db.membership.create({ data: { weddingId, userId: marcos.userId, role: 'owner' } });
    const planner = await seedReferrer({ db, kind: 'planner', name: 'Juliana Prado' });
    const referrer = await db.referrer.findUniqueOrThrow({ where: { userId: planner.userId } });
    await db.wedding.update({
      where: { id: weddingId },
      data: {
        eventDate: new Date(`${eventDate}T00:00:00Z`),
        referrerId: referrer.id,
        referralSource: 'referral_link',
      },
    });
    return { ana, marcos, juliana, weddingId, plannerUserId: planner.userId };
  }

  async function quote(
    cookie: string,
    weddingId: string,
    method: 'pix' | 'card',
    installments = 1,
  ) {
    const response = await request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing/quote`)
      .set('Cookie', cookie)
      .query({ kind: 'publication', endDate, method, installments })
      .expect(200);
    return response.body as { totalCents: number; priceVersion: string };
  }

  type PayCall = Promise<request.Response> & {
    expect: (status: number) => Promise<request.Response>;
  };

  /** Cota e paga; `.expect(status)` confere o status e mostra o corpo quando erra. */
  function pay(args: {
    cookie: string;
    weddingId: string;
    method?: 'pix' | 'card';
    installments?: number;
    key?: string;
    cardToken?: string;
    overrides?: Record<string, unknown>;
  }): PayCall {
    const {
      cookie,
      weddingId,
      method = 'card',
      installments = method === 'card' ? 2 : 1,
      key = randomUUID(),
      cardToken = 'tok_local_4242',
      overrides = {},
    } = args;
    const call = (async () => {
      const { totalCents, priceVersion } = await quote(cookie, weddingId, method, installments);
      return request(app.getHttpServer())
        .post(`/v1/weddings/${weddingId}/payments`)
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .set('Idempotency-Key', key)
        .send({
          kind: 'publication',
          endDate,
          method,
          installments,
          payer: { name: 'Ana Beatriz Moreira', taxId: CPF },
          ...(method === 'card' ? { cardToken } : {}),
          priceVersion,
          expectedTotalCents: totalCents,
          ...overrides,
        });
    })();
    return Object.assign(call, {
      expect: async (status: number) => {
        const response = await call;
        if (response.status !== status)
          throw new Error(
            `Esperava ${status}, veio ${response.status}: ${JSON.stringify(response.body)}`,
          );
        return response;
      },
    });
  }

  const dev = (paymentId: string, event: string, body: object = {}) =>
    request(app.getHttpServer()).post(`/v1/dev/payments/${paymentId}/${event}`).send(body);

  const billing = (cookie: string, weddingId: string) =>
    request(app.getHttpServer())
      .get(`/v1/weddings/${weddingId}/billing`)
      .set('Cookie', cookie)
      .expect(200);

  it('RN03, RN04 e RN05 - pagar no cartão publica só na confirmação', async () => {
    const { ana, marcos, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    expect(created.body).toMatchObject({
      status: 'pending',
      method: 'card',
      nextAction: { type: 'none' },
    });
    const paymentId = created.body.paymentId as string;
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('draft');

    await dev(paymentId, 'confirm').expect(200);

    const wedding = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
    expect(wedding).toMatchObject({
      status: 'published',
      publicationSource: 'payment',
      publishedByUserId: ana.userId,
    });
    expect(wedding.endDate?.toISOString().slice(0, 10)).toBe(endDate);
    expect(wedding.paidThrough?.toISOString().slice(0, 10)).toBe(endDate);
    expect(wedding.publishedAt).not.toBeNull();

    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment).toMatchObject({ status: 'paid', gatewayFeeCents: 199 });
    expect(payment.appliedAt).not.toBeNull();
    expect(payment.gatewayChargedCents).toBe(payment.amountCents);

    // RN13: a notificação billing às duas pessoas donas.
    const notifications = await db.notification.findMany({ where: { weddingId, type: 'billing' } });
    expect(notifications.map((row) => row.userId).sort()).toEqual(
      [ana.userId, marcos.userId].sort(),
    );
    expect(notifications[0].payload).toEqual([
      expect.objectContaining({ kind: 'payment_confirmed', endDate, paymentId }),
    ]);
    // RN05: os logs.
    const actions = (
      await db.applicationLog.findMany({ where: { weddingId }, select: { action: true } })
    ).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(['payment.created', 'payment.paid', 'wedding.published']),
    );
    // RN13: o e-mail, sem valor.
    const [email] = await waitForInbox({ to: ana.email });
    expect(email.Subject).toBe('Pagamento confirmado. O site está no ar');
  });

  it('RN05 (G5) - na primeira publicação, a indicadora recebe o wedding_published', async () => {
    const { ana, weddingId, plannerUserId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    await dev(created.body.paymentId as string, 'confirm').expect(200);
    expect(
      await db.notification.count({
        where: { weddingId, userId: plannerUserId, type: 'wedding_published' },
      }),
    ).toBe(1);
  });

  it('RN03 - Pix: copia e cola e vencimento em 24 h; a colaboradora vê só "Aguardando pagamento"', async () => {
    const { ana, juliana, weddingId } = await scenario();
    const before = Date.now();
    const created = await pay({
      cookie: ana.cookie,
      weddingId,
      method: 'pix',
      installments: 1,
    }).expect(201);
    expect(created.body).toMatchObject({ status: 'pending', method: 'pix' });
    expect((created.body.pix as { copyPaste: string }).copyPaste).toMatch(/^00020126/);
    const dueAt = Date.parse(created.body.dueAt as string);
    expect(dueAt - before).toBeGreaterThanOrEqual(24 * 3600_000 - 60_000);
    expect(dueAt - before).toBeLessThanOrEqual(24 * 3600_000 + 60_000);

    const owner = await billing(ana.cookie, weddingId);
    expect(owner.body).toMatchObject({
      status: 'draft',
      awaitingPayment: true,
      pendingPayment: {
        paymentId: created.body.paymentId,
        method: 'pix',
        pixCopyPaste: (created.body.pix as { copyPaste: string }).copyPaste,
      },
      payments: [],
      payer: { name: 'Ana Beatriz Moreira', taxIdLast4: '4725' },
    });
    const collaborator = await billing(juliana.cookie, weddingId);
    expect(collaborator.body).toEqual({
      status: 'draft',
      publishedAt: null,
      endDate: null,
      paidThrough: null,
      graceUntil: null,
      expiredAt: null,
      purgeAt: null,
      publicationSource: null,
      awaitingPayment: true,
    });
  });

  it('RN03 (B2-10) - a mesma chave e o mesmo corpo devolvem o mesmo pagamento; outro corpo, 422', async () => {
    const { ana, weddingId } = await scenario();
    const key = randomUUID();
    const first = await pay({ cookie: ana.cookie, weddingId, method: 'pix', installments: 1, key });
    const again = await pay({ cookie: ana.cookie, weddingId, method: 'pix', installments: 1, key });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(await db.payment.count({ where: { weddingId } })).toBe(1);

    const other = await pay({
      cookie: ana.cookie,
      weddingId,
      method: 'pix',
      installments: 1,
      key,
      overrides: { payer: { name: 'Marcos Lima', taxId: CPF } },
    }).expect(422);
    expect(other.body).toMatchObject({ error: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('B2-10 - sem Idempotency-Key, ou fora do formato: 400', async () => {
    const { ana, weddingId } = await scenario();
    const response = await pay({ cookie: ana.cookie, weddingId, key: 'nao-e-uuid' }).expect(400);
    expect(response.body).toMatchObject({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
  });

  it('RN03 - cartão recusado: falha, o casamento continua em rascunho e dá para tentar de novo', async () => {
    const { ana, weddingId } = await scenario();
    const refused = await pay({
      cookie: ana.cookie,
      weddingId,
      cardToken: 'tok_local_0002',
    }).expect(201);
    expect(refused.body).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe('draft');
    await pay({ cookie: ana.cookie, weddingId }).expect(201);
  });

  it('RN02 - CPF inválido: 400, sem o número na resposta', async () => {
    const { ana, weddingId } = await scenario();
    const response = await pay({
      cookie: ana.cookie,
      weddingId,
      overrides: { payer: { name: 'Ana', taxId: '111.111.111-11' } },
    }).expect(400);
    expect(response.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'payer.taxId' })]),
    );
    expect(JSON.stringify(response.body)).not.toContain('111.111.111-11');
  });

  it('RN02 (B2-13) - o CPF não fica guardado inteiro: nem no pagamento, nem no cliente, nem no log, nem no evento', async () => {
    const { ana, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    const paymentId = created.body.paymentId as string;
    await dev(paymentId, 'confirm').expect(200);

    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.payerTaxIdLast4).toBe('4725');
    expect(payment.payerTaxIdHash).not.toContain(CPF_DIGITS);
    const stored = JSON.stringify({
      payment,
      customers: await db.gatewayCustomer.findMany({ where: { weddingId } }),
      logs: await db.applicationLog.findMany({ where: { weddingId } }),
      events: await db.gatewayEvent.findMany({ where: { paymentId } }),
      gateway: await db.$queryRawUnsafe(
        `SELECT * FROM local_gateway.customers c
         JOIN local_gateway.charges ch ON ch.customer_id = c.id
         WHERE ch.external_reference = $1`,
        paymentId,
      ),
    });
    expect(stored).not.toContain(CPF_DIGITS);
    expect(stored).not.toContain(CPF);
  });

  it('RN09 - webhook repetido e o "recebido" do mesmo pagamento aplicam uma vez só', async () => {
    const { ana, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    const paymentId = created.body.paymentId as string;
    await dev(paymentId, 'confirm', { repeat: 3 }).expect(200);
    // O "recebido" depois do "confirmado" (mesmo fato, outro evento).
    const charge = await app
      .get(LocalGatewayStore)
      .chargeByReference({ externalReference: paymentId });
    await request(app.getHttpServer())
      .post('/v1/webhooks/payments/local')
      .set(LOCAL_WEBHOOK_TOKEN_HEADER, process.env.PAYMENT_WEBHOOK_SECRET ?? '')
      .send({
        id: `evt_${randomUUID()}`,
        type: 'charge.received',
        externalReference: paymentId,
        gatewayPaymentId: charge?.id,
        chargedCents: charge?.charged_cents,
        feeCents: 199,
        netCents: null,
      })
      .expect(200);
    await dev(paymentId, 'confirm').expect(200);
    expect(await db.applicationLog.count({ where: { weddingId, action: 'payment.paid' } })).toBe(1);
    expect(
      await db.notification.count({ where: { weddingId, userId: ana.userId, type: 'billing' } }),
    ).toBe(1);
  });

  it('RN09 (B2-6) - webhook forjado: a consulta diz pendente, e o pagamento continua pendente', async () => {
    const { ana, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    const paymentId = created.body.paymentId as string;
    // Assinatura válida, mas o gateway não confirmou nada.
    await request(app.getHttpServer())
      .post('/v1/webhooks/payments/local')
      .set(LOCAL_WEBHOOK_TOKEN_HEADER, process.env.PAYMENT_WEBHOOK_SECRET ?? '')
      .send({
        id: `evt_${randomUUID()}`,
        type: 'charge.confirmed',
        externalReference: paymentId,
        gatewayPaymentId: null,
        chargedCents: 99_999,
        feeCents: 0,
        netCents: 99_999,
      })
      .expect(200);
    // O worker processa o evento da fila.
    const deadline = Date.now() + 10_000;
    let event = await db.gatewayEvent.findFirst({
      where: { paymentId, processedAt: { not: null } },
    });
    while (!event && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      event = await db.gatewayEvent.findFirst({ where: { paymentId, processedAt: { not: null } } });
    }
    expect(event).toMatchObject({ result: 'unchanged' });
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: 'pending',
    });
  });

  it('RN03 (B2-1) - o gateway não responde: 503, o Payment fica pendente sem id do gateway; o webhook depois acha pela referência', async () => {
    const { ana, weddingId } = await scenario();
    // A falha com escopo no pagador: as suítes em paralelo não a consomem.
    const payerName = `Ana Sem Resposta ${randomUUID()}`;
    await app.get(LocalGatewayStore).failNextCalls({ count: 1, scope: payerName });
    const key = randomUUID();
    const failed = await pay({
      cookie: ana.cookie,
      weddingId,
      key,
      overrides: { payer: { name: payerName, taxId: CPF } },
    }).expect(503);
    expect(failed.body).toMatchObject({ error: 'GATEWAY_UNAVAILABLE' });
    const paymentId = failed.body.paymentId as string;
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({
      status: 'pending',
      gatewayPaymentId: null,
    });

    // A cobrança saiu no gateway, mas a resposta se perdeu: o evento chega antes do passo 3.
    const gateway = app.get<PaymentGateway>(PAYMENT_GATEWAY);
    const { customerId } = await gateway.createCustomer({ name: 'Ana', taxId: CPF });
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await gateway.chargeCard({
      customerId,
      externalReference: paymentId,
      amountCents: payment.amountCents,
      installments: payment.installments,
      cardToken: 'tok_local_4242',
      description: 'Publicação',
    });
    await dev(paymentId, 'confirm').expect(200);
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'published',
    );
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).gatewayPaymentId,
    ).not.toBeNull();
  });

  it.each([
    [30_000, 'não é aplicado', false],
    [40_000, 'é aplicado', true],
  ])(
    'RN09 (B2-7) - o gateway confirma R$ %i: o pagamento %s e o alerta abre',
    async (charged, _label, applied) => {
      const { ana, weddingId } = await scenario();
      const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
      const paymentId = created.body.paymentId as string;
      await dev(paymentId, 'confirm', { amountCents: charged }).expect(200);
      const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(payment.status).toBe('paid');
      expect(payment.gatewayChargedCents).toBe(charged);
      expect(payment.appliedAt !== null).toBe(applied);
      expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
        applied ? 'published' : 'draft',
      );
      expect(
        await db.alert.count({
          where: { type: 'gateway_amount_mismatch', entityId: paymentId, status: 'open' },
        }),
      ).toBe(1);
    },
  );

  it('RN08 e RN10 (B2-2) - Pix antigo pago depois do cartão: pago sem ser aplicado, estorno automático, alerta, e o cartão continua valendo', async () => {
    const { ana, weddingId } = await scenario();
    const pix = await pay({ cookie: ana.cookie, weddingId, method: 'pix', installments: 1 }).expect(
      201,
    );
    const pixId = pix.body.paymentId as string;
    // O Pix foi cancelado (Gerar novo Pix ou o vencimento, no PR da reconciliação).
    await db.payment.update({
      where: { id: pixId },
      data: { status: 'canceled', canceledAt: new Date() },
    });
    const card = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    await dev(card.body.paymentId as string, 'confirm').expect(200);

    await dev(pixId, 'confirm').expect(200);
    const orphan = await db.payment.findUniqueOrThrow({ where: { id: pixId } });
    // Pago e sem destino: vira estorno automático (Pagamentos e arrependimento).
    expect(orphan).toMatchObject({ status: 'refund_requested', refundOrigin: 'automatic' });
    expect(orphan.paidAt).not.toBeNull();
    expect(orphan.appliedAt).toBeNull();
    expect(
      await db.alert.count({ where: { type: 'orphan_payment', entityId: pixId, status: 'open' } }),
    ).toBe(1);
    const applied = await db.payment.findUniqueOrThrow({
      where: { id: card.body.paymentId as string },
    });
    expect(applied.appliedAt).not.toBeNull();
    expect((await db.wedding.findUniqueOrThrow({ where: { id: weddingId } })).status).toBe(
      'published',
    );
  });

  it('RN07 - dois donos pagando ao mesmo tempo: um pagamento, o outro PAYMENT_PENDING', async () => {
    const { ana, marcos, weddingId } = await scenario();
    const [first, second] = await Promise.all([
      pay({ cookie: ana.cookie, weddingId }),
      pay({ cookie: marcos.cookie, weddingId }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refused.body).toMatchObject({ error: 'PAYMENT_PENDING' });
    expect(await db.payment.count({ where: { weddingId } })).toBe(1);
  });

  it('Preço e cotação RN05 - o total mudou entre a cotação e o pagamento: PRICE_CHANGED', async () => {
    const { ana, weddingId } = await scenario();
    const response = await pay({
      cookie: ana.cookie,
      weddingId,
      overrides: { expectedTotalCents: 1 },
    }).expect(409);
    expect(response.body).toMatchObject({ error: 'PRICE_CHANGED' });
    expect(await db.payment.count({ where: { weddingId } })).toBe(0);
  });

  it('RN08 (B2-9) - publicar de novo com reembolso em andamento: REFUND_IN_PROGRESS', async () => {
    const { ana, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    await db.payment.update({
      where: { id: created.body.paymentId as string },
      data: {
        status: 'refund_requested',
        paidAt: new Date(),
        refundOrigin: 'couple',
        refundRequestedAt: new Date(),
      },
    });
    const response = await pay({ cookie: ana.cookie, weddingId }).expect(409);
    expect(response.body).toMatchObject({ error: 'REFUND_IN_PROGRESS' });
  });

  it('RN01 - a colaboradora não paga: ACTION_NOT_ALLOWED', async () => {
    const { juliana, weddingId } = await scenario();
    const response = await request(app.getHttpServer())
      .post(`/v1/weddings/${weddingId}/payments`)
      .set('Cookie', juliana.cookie)
      .set('Origin', ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send({
        kind: 'publication',
        endDate,
        method: 'pix',
        installments: 1,
        payer: { name: 'Juliana Prado', taxId: CPF },
        priceVersion: '2026-11',
        expectedTotalCents: 1000,
      })
      .expect(403);
    expect(response.body).toMatchObject({ error: 'ACTION_NOT_ALLOWED' });
  });

  it('RN20 - o dono vê os pagamentos aplicados; os não aplicados não vêm', async () => {
    const { ana, weddingId } = await scenario();
    const created = await pay({ cookie: ana.cookie, weddingId }).expect(201);
    await dev(created.body.paymentId as string, 'confirm').expect(200);
    const response = await billing(ana.cookie, weddingId);
    expect(response.body).toMatchObject({
      status: 'published',
      publicationSource: 'payment',
      awaitingPayment: false,
      pendingPayment: null,
      payments: [
        expect.objectContaining({
          id: created.body.paymentId,
          kind: 'publication',
          periodEnd: endDate,
          method: 'card',
          installments: 2,
          status: 'paid',
        }),
      ],
    });
  });
});
