import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  TAX_ID_HASHER,
  type TaxIdHasher,
} from '../../../shared/crypto/application/tax-id-hasher.port';
import { uuidV7 } from '../../../shared/ids/uuid-v7';
import { WeddingScope } from '../../access/application/wedding-scope.service';
import { WeddingAuthorization } from '../../access/application/wedding-authorization.service';
import { WeddingNotFoundError } from '../../access/domain/access.errors';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import {
  IdempotencyKeyReusedError,
  PaymentAlreadyPaidError,
  PaymentGatewayUnavailableError,
  PaymentPendingError,
  PriceChangedError,
  RefundInProgressError,
} from '../domain/billing.errors';
import type { PaymentKindForPrice, PaymentMethodForPrice } from '../domain/pricing';
import { buildQuote, referralDiscountFor } from '../domain/quote';
import {
  GATEWAY_CUSTOMERS,
  type GatewayCustomers,
  type OwnedPayment,
  PAYMENT_REQUEST_STORE,
  type PaymentRequestStore,
} from './ports/payment-request.store.port';
import {
  type ChargeResult,
  GatewayUnavailableError,
  type NextAction,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './ports/payment-gateway.port';
import { QUOTE_TARGET_READER, type QuoteTargetReader } from './ports/quote-target.reader.port';
import { SyncPaymentWithGateway } from './sync-payment.use-case';

/** O Pix vale 24 horas (decisão 41). */
const PIX_VALIDITY_MS = 24 * 60 * 60 * 1000;

export interface CreatePaymentInput {
  userId: string;
  weddingId: string;
  idempotencyKey: string;
  kind: PaymentKindForPrice;
  endDate: string;
  method: PaymentMethodForPrice;
  installments: number;
  payer: { name: string; taxId: string };
  cardToken: string | null;
  /** O pendente que este pedido troca (RN07; B2-4). */
  replacesPaymentId: string | null;
  priceVersion: string;
  expectedTotalCents: number;
  ip: string | null;
  now: Date;
}

export interface PaymentCreated {
  paymentId: string;
  status: OwnedPayment['status'];
  method: 'pix' | 'card';
  amountCents: number;
  dueAt: Date | null;
  pixCopyPaste: string | null;
  failureReason: string | null;
  nextAction: NextAction;
}

/**
 * POST …/payments (Publicar e pagar RN03; decisão 231, B2-1, B2-10 e B2-11).
 * Nenhuma chamada à porta acontece dentro de transação (RN19):
 * 1. transação 1: recalcula a cotação, grava o Payment pendente com
 *    `externalReference = id` e faz o commit;
 * 2. fora de transação: o cliente do pagador e a cobrança no gateway;
 * 3. transação 2: grava o id do gateway, o copia e cola e o vencimento.
 * O site só vai ao ar na confirmação (RN04), no worker. A mesma
 * Idempotency-Key com o mesmo corpo devolve o mesmo Payment (e retoma o
 * passo 2 se ele não terminou); com outro corpo, 422.
 *
 * Trocar o pendente (RN07; B2-4: Gerar novo Pix, trocar o Pix pelo cartão):
 * antes do passo 1, cancela o anterior no gateway, fora de transação, e
 * aplica o estado que a consulta devolve. Se o gateway diz que já foi pago, o
 * pagamento é aplicado e o pedido recebe 409 PAYMENT_ALREADY_PAID.
 */
@Injectable()
export class CreatePayment {
  constructor(
    private readonly scope: WeddingScope,
    private readonly authorization: WeddingAuthorization,
    @Inject(PAYMENT_REQUEST_STORE) private readonly payments: PaymentRequestStore,
    @Inject(QUOTE_TARGET_READER) private readonly quotes: QuoteTargetReader,
    @Inject(GATEWAY_CUSTOMERS) private readonly customers: GatewayCustomers,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(TAX_ID_HASHER) private readonly taxIds: TaxIdHasher,
    @Inject(APPLICATION_LOG_WRITER) private readonly log: ApplicationLogWriter,
    private readonly sync: SyncPaymentWithGateway,
  ) {}

  async execute(input: CreatePaymentInput): Promise<PaymentCreated> {
    const digest = this.taxIds.digest({ taxId: input.payer.taxId });
    const requestHash = requestHashOf({ input, payerTaxIdHash: digest.hash });
    if (input.replacesPaymentId)
      await this.replacePending({ input, replacesPaymentId: input.replacesPaymentId });

    // Transação 1 (RN03, passo 1).
    const payment = await this.scope.run({
      userId: input.userId,
      weddingId: input.weddingId,
      work: () => this.recordPending({ input, digest, requestHash }),
    });
    if (payment.gatewayPaymentId || payment.status !== 'pending') return created(payment);

    // Passo 2, fora de transação (RN19).
    let charge: ChargeResult;
    try {
      charge = await this.charge({ input, paymentId: payment.id, payerTaxIdHash: digest.hash });
    } catch (error) {
      // O Payment pendente sem id do gateway fica para a reconciliação (RN11).
      if (error instanceof GatewayUnavailableError)
        throw new PaymentGatewayUnavailableError(payment.id);
      throw error;
    }

    // Transação 2 (RN03, passo 3).
    return this.scope.run({
      userId: input.userId,
      weddingId: input.weddingId,
      work: async () => {
        await this.payments.recordCharge({
          paymentId: payment.id,
          gatewayPaymentId: charge.gatewayPaymentId,
          refused: charge.outcome === 'refused',
          pixCopyPaste: charge.pixCopyPaste,
          dueAt: charge.dueAt,
          cardLast4: charge.cardLast4,
          failureReason: charge.outcome === 'refused' ? (charge.failureReason ?? 'refused') : null,
        });
        if (charge.outcome === 'refused')
          await this.log.record({
            entry: {
              action: 'payment.failed',
              actorKind: 'user',
              actorUserId: input.userId,
              weddingId: input.weddingId,
              entityType: 'payment',
              entityId: payment.id,
              data: { reason: charge.failureReason ?? 'refused' },
              ...(input.ip ? { ip: input.ip } : {}),
            },
          });
        const saved = await this.payments.byId({
          weddingId: input.weddingId,
          paymentId: payment.id,
        });
        if (!saved) throw new WeddingNotFoundError();
        return { ...created(saved), nextAction: charge.nextAction };
      },
    });
  }

  private async recordPending({
    input,
    digest,
    requestHash,
  }: {
    input: CreatePaymentInput;
    digest: { hash: string; version: number; last4: string };
    requestHash: string;
  }): Promise<OwnedPayment> {
    const { userId, weddingId } = input;
    await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
    const wedding = await this.payments.lockWedding({ weddingId });
    if (!wedding) throw new WeddingNotFoundError();

    const existing = await this.payments.byIdempotencyKey({
      weddingId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new IdempotencyKeyReusedError();
      return existing;
    }

    if (input.kind === 'publication' && (await this.payments.hasRefundInProgress({ weddingId })))
      throw new RefundInProgressError();
    if (await this.payments.hasPending({ weddingId, kind: input.kind }))
      throw new PaymentPendingError();

    const referral =
      input.kind === 'publication'
        ? referralDiscountFor({
            referrer: wedding.referrer,
            percent: await this.quotes.referralDiscountPercent(),
          })
        : null;
    // A cotação manda (Preço e cotação RN05): o servidor recalcula e compara.
    const quote = buildQuote({
      wedding,
      kind: input.kind,
      endDate: input.endDate,
      method: input.method,
      installments: input.installments,
      referral,
      now: input.now,
    });
    const lines = quote.lines;
    if (
      !lines ||
      quote.priceVersion !== input.priceVersion ||
      lines.totalCents !== input.expectedTotalCents
    )
      throw new PriceChangedError();

    const id = uuidV7({ now: input.now.getTime() });
    await this.payments.insertPending({
      payment: {
        id,
        weddingId,
        kind: input.kind,
        method: input.method,
        installments: lines.installments,
        priceVersion: lines.priceVersion,
        periodStart: quote.periodStart,
        periodEnd: input.endDate,
        monthsCovered: lines.monthsCovered,
        activationListCents: lines.activationListCents,
        monthlyListCents: lines.monthlyListCents,
        capDiscountCents: lines.capDiscountCents,
        referralDiscountCents: lines.referralDiscountCents,
        pixDiscountCents: lines.pixDiscountCents,
        installmentInterestCents: lines.installmentInterestCents,
        amountCents: lines.totalCents,
        gateway: this.gateway.name,
        payerName: input.payer.name.trim(),
        payerTaxIdHash: digest.hash,
        payerTaxIdHashVersion: digest.version,
        payerTaxIdLast4: digest.last4,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        createdByUserId: userId,
        previousEndDate: input.kind === 'extension' ? wedding.endDate : null,
        previousPaidThrough: input.kind === 'extension' ? wedding.paidThrough : null,
        replacesPaymentId: input.replacesPaymentId,
      },
    });
    await this.log.record({
      entry: {
        action: 'payment.created',
        actorKind: 'user',
        actorUserId: userId,
        weddingId,
        entityType: 'payment',
        entityId: id,
        data: {
          kind: input.kind,
          method: input.method,
          installments: lines.installments,
          amountCents: lines.totalCents,
          priceVersion: lines.priceVersion,
        },
        ...(input.ip ? { ip: input.ip } : {}),
      },
    });
    const payment = await this.payments.byId({ weddingId, paymentId: id });
    if (!payment) throw new WeddingNotFoundError();
    return payment;
  }

  /**
   * Cancela o pendente trocado (RN07; B2-4). O pedido repetido com a mesma
   * chave já criou o novo: segue o caminho da idempotência. O trocado que não
   * é deste casamento, ou que já não está pendente, não muda nada; o pago
   * recebe 409; o de outro tipo também não muda. A consulta pela referência vale mesmo sem o id do gateway.
   */
  private async replacePending({
    input,
    replacesPaymentId,
  }: {
    input: CreatePaymentInput;
    replacesPaymentId: string;
  }): Promise<void> {
    const { userId, weddingId } = input;
    const replaced = await this.scope.run({
      userId,
      weddingId,
      work: async () => {
        await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
        const existing = await this.payments.byIdempotencyKey({
          weddingId,
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) return null;
        return this.payments.byId({ weddingId, paymentId: replacesPaymentId });
      },
    });
    // Só troca o pendente do mesmo tipo (a publicação não cancela a extensão).
    if (!replaced || replaced.kind !== input.kind) return;
    if (['paid', 'refund_requested', 'refunded', 'disputed'].includes(replaced.status))
      throw new PaymentAlreadyPaidError();
    if (replaced.status !== 'pending') return;

    // Fora de transação (RN19).
    try {
      let charge = await this.gateway.getCharge({ externalReference: replaced.id });
      if (!charge) {
        await this.sync.cancelWithoutCharge({ paymentId: replaced.id, now: input.now });
        return;
      }
      if (charge.status === 'pending' || charge.status === 'overdue') {
        await this.gateway.cancelCharge({ gatewayPaymentId: charge.gatewayPaymentId });
        // O estado depois do cancelamento: cancelado, ou pago no meio do caminho.
        charge = await this.gateway.getCharge({ externalReference: replaced.id });
        if (!charge) return;
      }
      await this.sync.execute({
        paymentId: replaced.id,
        charge,
        now: input.now,
        cancelReason: 'replaced',
      });
      if (charge.status === 'confirmed') throw new PaymentAlreadyPaidError();
    } catch (error) {
      if (error instanceof GatewayUnavailableError)
        throw new PaymentGatewayUnavailableError(replaced.id);
      throw error;
    }
  }

  /** Passo 2: o cliente do pagador (B2-11) e a cobrança, com a referência do Kore. */
  private async charge({
    input,
    paymentId,
    payerTaxIdHash,
  }: {
    input: CreatePaymentInput;
    paymentId: string;
    payerTaxIdHash: string;
  }): Promise<ChargeResult> {
    const gateway = this.gateway.name;
    let customerId = await this.customers.find({
      weddingId: input.weddingId,
      gateway,
      payerTaxIdHash,
    });
    if (!customerId) {
      const created = await this.gateway.createCustomer({
        name: input.payer.name.trim(),
        taxId: input.payer.taxId,
      });
      customerId = await this.customers.save({
        weddingId: input.weddingId,
        gateway,
        payerTaxIdHash,
        gatewayCustomerId: created.customerId,
      });
    }
    const payment = await this.scope.run({
      userId: input.userId,
      weddingId: input.weddingId,
      work: () => this.payments.byId({ weddingId: input.weddingId, paymentId }),
    });
    if (!payment) throw new WeddingNotFoundError();
    const description =
      input.kind === 'publication' ? 'Kore: publicação do site' : 'Kore: extensão do site';
    return input.method === 'pix'
      ? this.gateway.chargePix({
          customerId,
          externalReference: paymentId,
          amountCents: payment.amountCents,
          dueAt: new Date(input.now.getTime() + PIX_VALIDITY_MS),
          description,
        })
      : this.gateway.chargeCard({
          customerId,
          externalReference: paymentId,
          amountCents: payment.amountCents,
          installments: payment.installments,
          cardToken: input.cardToken,
          description,
        });
  }
}

function created(payment: OwnedPayment): PaymentCreated {
  return {
    paymentId: payment.id,
    status: payment.status,
    method: payment.method,
    amountCents: payment.amountCents,
    dueAt: payment.dueAt,
    pixCopyPaste: payment.pixCopyPaste,
    failureReason: payment.failureReason,
    nextAction: { type: 'none' },
  };
}

/**
 * O hash do corpo do pedido (B2-10), sem o CPF em claro (vai o HMAC) e sem o
 * token do cartão (o token é de uso único; a nova tentativa traz outro).
 */
export function requestHashOf({
  input,
  payerTaxIdHash,
}: {
  input: CreatePaymentInput;
  payerTaxIdHash: string;
}): string {
  const canonical = JSON.stringify([
    input.kind,
    input.endDate,
    input.method,
    input.installments,
    input.payer.name.trim(),
    payerTaxIdHash,
    input.priceVersion,
    input.expectedTotalCents,
    // Só quando troca: o hash dos pedidos sem troca continua o mesmo.
    ...(input.replacesPaymentId ? [input.replacesPaymentId] : []),
  ]);
  return createHash('sha256').update(canonical).digest('base64url');
}
