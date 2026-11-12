import { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { GATEWAY_EVENT_STORE } from '../../src/modules/billing/application/ports/gateway-event.store.port';
import {
  GatewayUnavailableError,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '../../src/modules/billing/application/ports/payment-gateway.port';
import { RequeueGatewayEvents } from '../../src/modules/billing/application/requeue-gateway-events.use-case';
import { LOCAL_WEBHOOK_TOKEN_HEADER } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-payment-gateway';
import {
  TAX_ID_HASHER,
  type TaxIdHasher,
} from '../../src/shared/crypto/application/tax-id-hasher.port';
import { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import { buildOpenApiDocument } from '../../src/shared/http/configure-app';
import { createTestApp } from '../support/create-test-app';
import { createTestWorker } from '../support/create-test-worker';
import { seedWedding } from '../support/weddings';
import { uuidV7 } from '../../src/shared/ids/uuid-v7';

/**
 * A porta do gateway, o adaptador local com o estado no Postgres, o webhook e a
 * rota dev (Publicar e pagar RN02, RN09, RN14, RN15 e RN21; decisão 231,
 * B2-5, B2-13, B2-14 e B2-15). A máquina de estados do pagamento entra no PR
 * do Publicar e pagar; aqui o evento é gravado, posto na fila e processado.
 */
describe('Gateway de pagamento e webhook (Publicar e pagar RN09, RN14 e RN15; banco real)', () => {
  let app: INestApplication;
  let worker: TestingModule;
  let db: BackofficePrismaService;
  let gateway: PaymentGateway;
  const secret = process.env.PAYMENT_WEBHOOK_SECRET ?? '';
  const CPF = '529.982.247-25';

  beforeAll(async () => {
    app = await createTestApp();
    worker = await createTestWorker();
    db = app.get(BackofficePrismaService);
    gateway = app.get<PaymentGateway>(PAYMENT_GATEWAY);
  });

  afterAll(async () => {
    await worker?.close();
    await app?.close();
  });

  /** Um Payment pendente (pelo backoffice) e a cobrança dele no gateway local. */
  async function pendingPayment({ method = 'card' }: { method?: 'card' | 'pix' } = {}) {
    const owner = await db.user.create({ data: { email: `ana.${randomUUID()}@kore.local` } });
    const { weddingId } = await seedWedding({ db, ownerId: owner.id });
    const id = uuidV7();
    const hasher = app.get<TaxIdHasher>(TAX_ID_HASHER);
    const digest = hasher.digest({ taxId: CPF });
    await db.payment.create({
      data: {
        id,
        weddingId,
        kind: 'publication',
        method,
        installments: method === 'card' ? 2 : 1,
        priceVersion: '2026-11',
        periodStart: new Date('2026-08-10'),
        periodEnd: new Date('2027-02-14'),
        monthsCovered: 7,
        activationListCents: 14900,
        monthlyListCents: 2900,
        pixDiscountCents: method === 'pix' ? 1056 : 0,
        amountCents: method === 'pix' ? 34144 : 35200,
        gateway: 'local',
        externalReference: id,
        payerName: 'Ana Beatriz Moreira',
        payerTaxIdHash: digest.hash,
        payerTaxIdHashVersion: digest.version,
        payerTaxIdLast4: digest.last4,
        idempotencyKey: randomUUID(),
        requestHash: 'h',
        createdByUserId: owner.id,
      },
    });
    const { customerId } = await gateway.createCustomer({
      name: 'Ana Beatriz Moreira',
      taxId: CPF,
    });
    const charge =
      method === 'card'
        ? await gateway.chargeCard({
            customerId,
            externalReference: id,
            amountCents: 35200,
            installments: 2,
            cardToken: 'tok_local_4242',
            description: 'Publicação',
          })
        : await gateway.chargePix({
            customerId,
            externalReference: id,
            amountCents: 34144,
            dueAt: new Date(Date.now() + 86_400_000),
            description: 'Publicação',
          });
    return { paymentId: id, charge };
  }

  function webhook(body: object, token: string | null = secret) {
    const call = request(app.getHttpServer())
      .post('/v1/webhooks/payments/local')
      .set('content-type', 'application/json');
    return (token === null ? call : call.set(LOCAL_WEBHOOK_TOKEN_HEADER, token)).send(
      JSON.stringify(body),
    );
  }

  const eventBody = (overrides: object = {}) => ({
    id: `evt_${randomUUID()}`,
    type: 'charge.confirmed',
    externalReference: null,
    gatewayPaymentId: null,
    chargedCents: 35200,
    feeCents: 199,
    netCents: 35001,
    ...overrides,
  });

  describe('Webhook (RN09)', () => {
    it('RN09 - assinatura inválida ou ausente: 401 e nada é gravado', async () => {
      const body = eventBody();
      const wrong = await webhook(body, 'segredo-errado').expect(401);
      expect(wrong.body).toMatchObject({ error: 'INVALID_SIGNATURE' });
      await webhook(body, null).expect(401);
      expect(await db.gatewayEvent.count({ where: { gatewayEventId: body.id } })).toBe(0);
    });

    it('RN14 - outro gateway na rota: 404', async () => {
      await request(app.getHttpServer())
        .post('/v1/webhooks/payments/asaas')
        .set(LOCAL_WEBHOOK_TOKEN_HEADER, secret)
        .send(eventBody())
        .expect(404);
    });

    it('RN09 - corpo que não se entende, com a assinatura certa: 400', async () => {
      const response = await webhook({ id: 'x', type: 'payment.weird' }).expect(400);
      expect(response.body).toMatchObject({ error: 'MALFORMED_EVENT' });
    });

    it('RN09 - grava o evento uma vez só, mesmo repetido, e responde 200', async () => {
      const body = eventBody();
      await webhook(body).expect(200, { received: true });
      await webhook(body).expect(200, { received: true });
      expect(await db.gatewayEvent.count({ where: { gatewayEventId: body.id } })).toBe(1);
    });

    it('RN02 (B2-13) - o payload guarda só os campos permitidos, sem o CPF de exemplo', async () => {
      const body = eventBody({ payerTaxId: CPF, payerName: 'Ana Beatriz Moreira', card: '4242' });
      await webhook(body).expect(200);
      const stored = await db.gatewayEvent.findFirstOrThrow({ where: { gatewayEventId: body.id } });
      expect(Object.keys(stored.payload as object).sort()).toEqual([
        'chargedCents',
        'externalReference',
        'feeCents',
        'gatewayPaymentId',
        'netCents',
        'type',
      ]);
      const raw = JSON.stringify(stored);
      expect(raw).not.toContain('52998224725');
      expect(raw).not.toContain('529.982.247-25');
      expect(raw).not.toContain('Ana Beatriz');
    });

    it('RN09 (integração) - se a gravação do evento falha, responde 5xx para o gateway reenviar', async () => {
      const failing = await createTestApp({
        override: (builder) =>
          builder.overrideProvider(GATEWAY_EVENT_STORE).useValue({
            record: () => Promise.reject(new Error('banco fora do ar')),
          }),
      });
      try {
        const response = await request(failing.getHttpServer())
          .post('/v1/webhooks/payments/local')
          .set(LOCAL_WEBHOOK_TOKEN_HEADER, secret)
          .send(eventBody());
        expect(response.status).toBeGreaterThanOrEqual(500);
      } finally {
        await failing.close();
      }
    });
  });

  describe('Adaptador local (RN14; B2-14)', () => {
    it('B2-14 - o estado fica no Postgres: o worker consulta a cobrança que a API criou', async () => {
      const { paymentId, charge } = await pendingPayment();
      const fromWorker = await worker.get<PaymentGateway>(PAYMENT_GATEWAY).getCharge({
        externalReference: paymentId,
      });
      expect(fromWorker).toMatchObject({
        gatewayPaymentId: charge.gatewayPaymentId,
        status: 'pending',
        cardLast4: '4242',
      });
    });

    it('RN14 - o cartão de teste terminado em 0002 é recusado na hora', async () => {
      const { customerId } = await gateway.createCustomer({ name: 'Ana', taxId: CPF });
      const refused = await gateway.chargeCard({
        customerId,
        externalReference: randomUUID(),
        amountCents: 35200,
        installments: 2,
        cardToken: 'tok_local_0002',
        description: 'Publicação',
      });
      expect(refused).toMatchObject({ outcome: 'refused', failureReason: 'card_declined' });
    });

    it('RN03 - o Pix devolve o copia e cola e o vencimento; a mesma referência, a mesma cobrança', async () => {
      const { paymentId, charge } = await pendingPayment({ method: 'pix' });
      expect(charge.outcome).toBe('pending');
      expect(charge.pixCopyPaste).toMatch(/^00020126/);
      expect(charge.dueAt).toBeInstanceOf(Date);
      const { customerId } = await gateway.createCustomer({ name: 'Ana', taxId: CPF });
      const again = await gateway.chargePix({
        customerId,
        externalReference: paymentId,
        amountCents: 34144,
        dueAt: new Date(),
        description: 'Publicação',
      });
      expect(again.gatewayPaymentId).toBe(charge.gatewayPaymentId);
    });

    it('RN07 - cancelar o Pix já pago diz que já foi pago', async () => {
      const { paymentId, charge } = await pendingPayment({ method: 'pix' });
      await request(app.getHttpServer()).post(`/v1/dev/payments/${paymentId}/confirm`).expect(200);
      expect(await gateway.cancelCharge({ gatewayPaymentId: charge.gatewayPaymentId })).toEqual({
        result: 'already_paid',
      });
    });

    it('RN15 (B2-15) - "o gateway não responde na próxima chamada": só a próxima falha', async () => {
      const { paymentId } = await pendingPayment();
      await request(app.getHttpServer())
        .post(`/v1/dev/payments/${paymentId}/fail`)
        .send({ failNextGatewayCall: true })
        .expect(200);
      await expect(gateway.getCharge({ externalReference: paymentId })).rejects.toThrow(
        GatewayUnavailableError,
      );
      expect(await gateway.getCharge({ externalReference: paymentId })).toMatchObject({
        status: 'refused',
      });
    });

    it('Repasse RN05 - o Pix de saída é idempotente pela referência', async () => {
      const reference = randomUUID();
      const first = await gateway.sendPixTransfer({
        externalReference: reference,
        amountCents: 15804,
        pixKey: 'juliana@prado.com.br',
        pixKeyType: 'email',
      });
      const second = await gateway.sendPixTransfer({
        externalReference: reference,
        amountCents: 15804,
        pixKey: 'juliana@prado.com.br',
        pixKeyType: 'email',
      });
      expect(second.gatewayTransferId).toBe(first.gatewayTransferId);
      await request(app.getHttpServer())
        .post(`/v1/dev/payments/${reference}/payout-paid`)
        .expect(200);
      expect(await gateway.getPixTransfer({ externalReference: reference })).toMatchObject({
        status: 'paid',
      });
    });
  });

  describe('Rota dev (RN15 e RN21)', () => {
    it('RN15 - passa pelo caminho do webhook e responde depois do processamento', async () => {
      const { paymentId, charge } = await pendingPayment();
      const response = await request(app.getHttpServer())
        .post(`/v1/dev/payments/${paymentId}/confirm`)
        .send({ amountCents: 34000 })
        .expect(200);
      const event = await db.gatewayEvent.findFirstOrThrow({
        where: { gatewayEventId: response.body.gatewayEventId as string },
      });
      expect(event).toMatchObject({ type: 'charge.confirmed', paymentId, result: 'recorded' });
      expect(event.processedAt).not.toBeNull();
      expect(event.payload).toMatchObject({
        gatewayPaymentId: charge.gatewayPaymentId,
        chargedCents: 34000,
        feeCents: 199,
        netCents: 33801,
      });
      expect(await gateway.getCharge({ externalReference: paymentId })).toMatchObject({
        status: 'confirmed',
        chargedCents: 34000,
      });
    });

    it('RN09 e RN15 - o evento repetido é gravado e processado uma vez só', async () => {
      const { paymentId } = await pendingPayment();
      const response = await request(app.getHttpServer())
        .post(`/v1/dev/payments/${paymentId}/confirm`)
        .send({ repeat: 3 })
        .expect(200);
      expect(response.body).toMatchObject({ deliveries: 3 });
      expect(
        await db.gatewayEvent.count({
          where: { gatewayEventId: response.body.gatewayEventId as string },
        }),
      ).toBe(1);
    });

    it('RN15 - evento fora da lista, pagamento sem cobrança ou id inválido: 404 ou 400', async () => {
      const { paymentId } = await pendingPayment();
      await request(app.getHttpServer()).post(`/v1/dev/payments/${paymentId}/explode`).expect(404);
      await request(app.getHttpServer())
        .post(`/v1/dev/payments/${randomUUID()}/confirm`)
        .expect(404);
      await request(app.getHttpServer()).post('/v1/dev/payments/nao-e-uuid/confirm').expect(400);
      await request(app.getHttpServer())
        .post(`/v1/dev/payments/${paymentId}/confirm`)
        .send({ amountCents: null })
        .expect(400);
    });

    it('RN15 - a rota dev fica fora do openapi.json', () => {
      const document = buildOpenApiDocument({ app });
      expect(Object.keys(document.paths).some((path) => path.includes('/dev/'))).toBe(false);
      expect(Object.keys(document.paths)).toContain('/v1/webhooks/payments/{gateway}');
    });
  });

  describe('Rotina de 5 minutos (RN09; B2-5)', () => {
    it('B2-5 - o evento gravado e não enfileirado volta à fila e é processado uma vez', async () => {
      const { paymentId } = await pendingPayment();
      const gatewayEventId = `evt_${randomUUID()}`;
      // Gravado há 10 minutos, sem entrar na fila (o Redis caiu entre os passos).
      const stored = await db.gatewayEvent.create({
        data: {
          gateway: 'local',
          gatewayEventId,
          type: 'charge.confirmed',
          payload: { type: 'charge.confirmed', externalReference: paymentId },
          receivedAt: new Date(Date.now() - 10 * 60_000),
        },
      });
      const result = await worker.get(RequeueGatewayEvents).execute({ now: new Date() });
      expect(result.requeued).toBeGreaterThanOrEqual(1);

      const deadline = Date.now() + 10_000;
      let processed = await db.gatewayEvent.findUniqueOrThrow({ where: { id: stored.id } });
      while (!processed.processedAt && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        processed = await db.gatewayEvent.findUniqueOrThrow({ where: { id: stored.id } });
      }
      expect(processed).toMatchObject({ paymentId, result: 'recorded' });
      expect(processed.processedAt).not.toBeNull();
    });
  });
});
