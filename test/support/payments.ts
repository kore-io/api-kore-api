import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { LocalGatewayStore } from '../../src/modules/billing/infrastructure/backoffice/local-gateway/local-gateway.store';
import type { BackofficePrismaService } from '../../src/shared/database/backoffice-prisma.service';
import request from 'supertest';

export const PAYER_CPF = '529.982.247-25';
const ORIGIN = process.env.ALLOWED_ORIGINS?.split(',')[0] ?? 'http://localhost:5173';

export interface PayArgs {
  app: INestApplication;
  cookie: string;
  weddingId: string;
  endDate: string;
  method?: 'pix' | 'card';
  installments?: number;
  key?: string;
  cardToken?: string;
  replacesPaymentId?: string;
  overrides?: Record<string, unknown>;
}

/**
 * Cota e paga a publicação (Publicar e pagar RN03) pela API, como o app: a
 * cotação do momento, o total esperado e a Idempotency-Key. Devolve a resposta
 * do POST sem conferir o status.
 */
export async function payForPublication({
  app,
  cookie,
  weddingId,
  endDate,
  method = 'card',
  installments = method === 'card' ? 2 : 1,
  key = randomUUID(),
  cardToken = 'tok_local_4242',
  replacesPaymentId,
  overrides = {},
}: PayArgs): Promise<request.Response> {
  const quote = await request(app.getHttpServer())
    .get(`/v1/weddings/${weddingId}/billing/quote`)
    .set('Cookie', cookie)
    .query({ kind: 'publication', endDate, method, installments })
    .expect(200);
  const { totalCents, priceVersion } = quote.body as { totalCents: number; priceVersion: string };
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
      payer: { name: 'Ana Beatriz Moreira', taxId: PAYER_CPF },
      ...(method === 'card' ? { cardToken } : {}),
      ...(replacesPaymentId ? { replacesPaymentId } : {}),
      priceVersion,
      expectedTotalCents: totalCents,
      ...overrides,
    });
}

/** Confere o status e mostra o corpo quando erra. */
export function expectStatus(response: request.Response, status: number): request.Response {
  if (response.status !== status)
    throw new Error(
      `Esperava ${status}, veio ${response.status}: ${JSON.stringify(response.body)}`,
    );
  return response;
}

/** A rota dev de pagamentos (RN15): dispara o evento e espera o processamento. */
export function devPaymentEvent({
  app,
  paymentId,
  event,
  body = {},
}: {
  app: INestApplication;
  paymentId: string;
  event: string;
  body?: object;
}) {
  return request(app.getHttpServer()).post(`/v1/dev/payments/${paymentId}/${event}`).send(body);
}

/**
 * Publica pelo caminho pago (Publicar e pagar RN17; B2-17): paga no cartão e
 * confirma pela rota dev, que processa em linha (RN21). Substitui a Cortesia
 * nos testes que só precisam de um site publicado.
 */
export async function publishByPayment({
  app,
  cookie,
  weddingId,
  endDate,
}: {
  app: INestApplication;
  cookie: string;
  weddingId: string;
  endDate: string;
}): Promise<{ paymentId: string }> {
  const created = expectStatus(await payForPublication({ app, cookie, weddingId, endDate }), 201);
  const paymentId = created.body.paymentId as string;
  expectStatus(await devPaymentEvent({ app, paymentId, event: 'confirm' }), 200);
  return { paymentId };
}

const day = (value: string) => new Date(`${value}T00:00:00Z`);

/**
 * Uma extensão paga e aplicada, com a cobrança confirmada no gateway local, e
 * o casamento estendido até o fim dela (o `POST …/payments` com `kind =
 * extension` entra no PR do ciclo de vida). R$ 87,00 no cartão, 3 meses.
 */
export async function seedPaidExtension({
  db,
  gateway,
  weddingId,
  ownerId,
  periodStart,
  periodEnd,
  paidAt = new Date(),
}: {
  db: BackofficePrismaService;
  gateway: LocalGatewayStore;
  weddingId: string;
  ownerId: string;
  periodStart: string;
  periodEnd: string;
  paidAt?: Date;
}): Promise<string> {
  const before = await db.wedding.findUniqueOrThrow({ where: { id: weddingId } });
  const id = randomUUID();
  const customerId = await gateway.createCustomer({ name: 'Ana', taxIdLast4: '4725' });
  const charge = await gateway.createCharge({
    externalReference: id,
    customerId,
    method: 'card',
    amountCents: 8700,
    installments: 1,
    status: 'confirmed',
    pixCopyPaste: null,
    dueAt: null,
    cardLast4: '4242',
    failureReason: null,
  });
  await gateway.updateCharge({ id: charge.id, status: 'confirmed', chargedCents: 8700 });
  await db.payment.create({
    data: {
      id,
      weddingId,
      kind: 'extension',
      status: 'paid',
      method: 'card',
      installments: 1,
      priceVersion: '2026-11',
      periodStart: day(periodStart),
      periodEnd: day(periodEnd),
      monthsCovered: 3,
      activationListCents: 0,
      monthlyListCents: 2900,
      amountCents: 8700,
      gateway: 'local',
      externalReference: id,
      gatewayPaymentId: charge.id,
      gatewayChargedCents: 8700,
      payerName: 'Ana Beatriz Moreira',
      payerTaxIdHash: `hash-${id}`,
      payerTaxIdHashVersion: 1,
      payerTaxIdLast4: '4725',
      idempotencyKey: randomUUID(),
      requestHash: 'x',
      createdByUserId: ownerId,
      paidAt,
      appliedAt: paidAt,
      cardLast4: '4242',
      previousEndDate: before.endDate,
      previousPaidThrough: before.paidThrough,
    },
  });
  await db.wedding.update({
    where: { id: weddingId },
    data: { endDate: day(periodEnd), paidThrough: day(periodEnd) },
  });
  return id;
}

/**
 * Cota e paga a extensão (Data de saída do ar RN04) pela API, como o app: a
 * cotação `kind = extension` do momento e o total esperado.
 */
export async function payForExtension({
  app,
  cookie,
  weddingId,
  endDate,
  method = 'card',
  installments = 1,
  key = randomUUID(),
}: Omit<PayArgs, 'cardToken' | 'replacesPaymentId' | 'overrides'>): Promise<request.Response> {
  const quote = await request(app.getHttpServer())
    .get(`/v1/weddings/${weddingId}/billing/quote`)
    .set('Cookie', cookie)
    .query({ kind: 'extension', endDate, method, installments })
    .expect(200);
  const { totalCents, priceVersion } = quote.body as { totalCents: number; priceVersion: string };
  return request(app.getHttpServer())
    .post(`/v1/weddings/${weddingId}/payments`)
    .set('Cookie', cookie)
    .set('Origin', ORIGIN)
    .set('Idempotency-Key', key)
    .send({
      kind: 'extension',
      endDate,
      method,
      installments,
      payer: { name: 'Ana Beatriz Moreira', taxId: PAYER_CPF },
      ...(method === 'card' ? { cardToken: 'tok_local_4242' } : {}),
      priceVersion,
      expectedTotalCents: totalCents,
    });
}
