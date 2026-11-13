import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
