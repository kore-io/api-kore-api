import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TAX_ID_HASHER, type TaxIdHasher } from '@/shared/crypto/application/tax-id-hasher.port';
import { uuidV7 } from '@/shared/kernel/ids/uuid-v7';
import { WeddingScope } from '@/modules/access/application/services/wedding-scope.service';
import { WeddingAuthorization } from '@/modules/access/application/services/wedding-authorization.service';
import { WeddingNotFoundError } from '@/modules/access/domain/access.errors';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '@/modules/logs/application/ports/application-log-writer.port';
import {
  BillingWeddingBlockedError,
  IdempotencyKeyReusedError,
  WeddingDeletionScheduledError,
  PaymentAlreadyPaidError,
  PaymentGatewayUnavailableError,
  PaymentPendingError,
  PreviousPayerNotFoundError,
  PriceChangedError,
  RefundInProgressError,
} from '@/modules/billing/domain/billing.errors';
import type {
  PaymentKindForPrice,
  PaymentMethodForPrice,
} from '@/modules/billing/domain/payments/pricing';
import { buildQuote, referralDiscountFor } from '@/modules/billing/domain/payments/quote';
import {
  GATEWAY_CUSTOMERS,
  type GatewayCustomers,
  type OwnedPayment,
  PAYMENT_REQUEST_STORE,
  type PaymentRequestStore,
} from '@/modules/billing/application/ports/payment-request.store.port';
import {
  type ChargeResult,
  GatewayUnavailableError,
  type NextAction,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from '@/modules/billing/application/ports/payment-gateway.port';
import {
  QUOTE_TARGET_READER,
  type QuoteTargetReader,
} from '@/modules/billing/application/ports/quote-target.reader.port';
import { CancelPendingPayment } from './cancel-pending-payment';

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
  /**
   * Quem paga (RN02): o nome e o CPF, ou o pagador anterior pelo `payerId`
   * (o cliente dele no gateway; RN03 e decisão 316(3)), sem o CPF.
   */
  payer: { name: string; taxId: string } | { payerId: string };
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
    private readonly cancelPending: CancelPendingPayment,
  ) {}

  async execute(input: CreatePaymentInput): Promise<PaymentCreated> {
    const payer = await this.resolvePayer({ input });
    const { digest } = payer;
    const requestHash = requestHashOf({ input, payer });
    if (input.replacesPaymentId)
      await this.replacePending({ input, replacesPaymentId: input.replacesPaymentId });

    // Transação 1 (RN03, passo 1).
    const payment = await this.scope.run({
      userId: input.userId,
      weddingId: input.weddingId,
      work: () => this.recordPending({ input, payerName: payer.name, digest, requestHash }),
    });
    if (payment.gatewayPaymentId || payment.status !== 'pending') return created(payment);

    // Passo 2, fora de transação (RN19).
    let charge: ChargeResult;
    try {
      charge = await this.charge({ input, payer, paymentId: payment.id });
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

  /**
   * Quem paga, já com o hash. O pagador anterior vem do cliente do gateway
   * deste casamento (RN03; decisão 316(3)): o nome, a versão do hash e os 4
   * últimos saem do último pagamento dele. Só o dono chega à consulta.
   */
  private async resolvePayer({ input }: { input: CreatePaymentInput }): Promise<ResolvedPayer> {
    const { payer } = input;
    if ('taxId' in payer)
      return {
        name: payer.name.trim(),
        taxId: payer.taxId,
        digest: this.taxIds.digest({ taxId: payer.taxId }),
      };
    const { userId, weddingId } = input;
    return this.scope.run({
      userId,
      weddingId,
      work: async () => {
        await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
        const customer = await this.customers.byId({
          id: payer.payerId,
          weddingId,
          gateway: this.gateway.name,
        });
        const previous = customer
          ? await this.payments.payerByHash({
              weddingId,
              payerTaxIdHash: customer.payerTaxIdHash,
            })
          : null;
        if (!customer || !previous) throw new PreviousPayerNotFoundError();
        return {
          name: previous.name,
          taxId: null,
          digest: {
            hash: customer.payerTaxIdHash,
            version: previous.taxIdHashVersion,
            last4: previous.taxIdLast4,
          },
        };
      },
    });
  }

  private async recordPending({
    input,
    payerName,
    digest,
    requestHash,
  }: {
    input: CreatePaymentInput;
    payerName: string;
    digest: { hash: string; version: number; last4: string };
    requestHash: string;
  }): Promise<OwnedPayment> {
    const { userId, weddingId } = input;
    await this.authorization.require({ userId, weddingId, action: 'manage_billing' });
    const wedding = await this.payments.lockWedding({ weddingId });
    if (!wedding) throw new WeddingNotFoundError();
    // Bloqueado e exclusão agendada não pagam (Publicar e pagar RN01; Data de saída do ar RN10).
    if (wedding.blockedAt) throw new BillingWeddingBlockedError();
    if (wedding.deletionScheduledFor) throw new WeddingDeletionScheduledError();

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

    // RN07: só o anterior deste casamento e do mesmo tipo (a FK não amarra o
    // casamento); o id de outro casamento, ou que não existe, não é gravado.
    const replaced = input.replacesPaymentId
      ? await this.payments.byId({ weddingId, paymentId: input.replacesPaymentId })
      : null;
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
        payerName,
        payerTaxIdHash: digest.hash,
        payerTaxIdHashVersion: digest.version,
        payerTaxIdLast4: digest.last4,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        createdByUserId: userId,
        previousEndDate: input.kind === 'extension' ? wedding.endDate : null,
        previousPaidThrough: input.kind === 'extension' ? wedding.paidThrough : null,
        replacesPaymentId: replaced && replaced.kind === input.kind ? replaced.id : null,
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
      const result = await this.cancelPending.execute({
        paymentId: replaced.id,
        reason: 'replaced',
        now: input.now,
      });
      if (result === 'paid') throw new PaymentAlreadyPaidError();
    } catch (error) {
      if (error instanceof GatewayUnavailableError)
        throw new PaymentGatewayUnavailableError(replaced.id);
      throw error;
    }
  }

  /** Passo 2: o cliente do pagador (B2-11) e a cobrança, com a referência do Kore. */
  private async charge({
    input,
    payer,
    paymentId,
  }: {
    input: CreatePaymentInput;
    payer: ResolvedPayer;
    paymentId: string;
  }): Promise<ChargeResult> {
    const gateway = this.gateway.name;
    const payerTaxIdHash = payer.digest.hash;
    let customerId = await this.customers.find({
      weddingId: input.weddingId,
      gateway,
      payerTaxIdHash,
    });
    if (!customerId) {
      // O pagador anterior já tem cliente (resolvePayer): sem CPF, nada a criar.
      if (payer.taxId === null) throw new PreviousPayerNotFoundError();
      const created = await this.gateway.createCustomer({
        name: payer.name,
        taxId: payer.taxId,
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

/** Quem paga, depois de resolvido: o CPF em claro só quando veio no pedido. */
interface ResolvedPayer {
  name: string;
  taxId: string | null;
  digest: { hash: string; version: number; last4: string };
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
 * token do cartão (o token é de uso único; a nova tentativa traz outro). O
 * pagador anterior por `payerId` entra com o nome e o hash dele, como se
 * viesse com o CPF: a mesma chave serve às duas formas.
 */
export function requestHashOf({
  input,
  payer,
}: {
  input: CreatePaymentInput;
  payer: { name: string; digest: { hash: string } };
}): string {
  const canonical = JSON.stringify([
    input.kind,
    input.endDate,
    input.method,
    input.installments,
    payer.name,
    payer.digest.hash,
    input.priceVersion,
    input.expectedTotalCents,
    // Só quando troca: o hash dos pedidos sem troca continua o mesmo.
    ...(input.replacesPaymentId ? [input.replacesPaymentId] : []),
  ]);
  return createHash('sha256').update(canonical).digest('base64url');
}
