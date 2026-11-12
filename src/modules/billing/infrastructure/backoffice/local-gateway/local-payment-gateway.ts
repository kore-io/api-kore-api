import { createHash, timingSafeEqual } from 'node:crypto';
import { type AppEnv, LOCAL_KEY_ENVS } from '../../../../../shared/config/env.schema';
import {
  type ChargeResult,
  GATEWAY_EVENT_TYPES,
  type GatewayCharge,
  type GatewayEventType,
  type GatewayTransfer,
  GatewayUnavailableError,
  type PaymentGateway,
  type WebhookVerification,
} from '../../../application/ports/payment-gateway.port';
import type { LocalChargeRow, LocalGatewayStore, LocalTransferRow } from './local-gateway.store';

/** O cabeçalho do segredo no webhook local. */
export const LOCAL_WEBHOOK_TOKEN_HEADER = 'x-local-gateway-token';

/** O cartão de teste recusado: o token que termina em 0002 (RN14). */
const REFUSED_CARD_SUFFIX = '0002';

/** O corpo do webhook local: o evento já no formato do Kore. */
export interface LocalWebhookBody {
  id: string;
  type: GatewayEventType;
  externalReference: string | null;
  gatewayPaymentId: string | null;
  chargedCents: number | null;
  feeCents: number | null;
  netCents: number | null;
}

/**
 * Adaptador local da porta PaymentGateway (Publicar e pagar RN14): responde na
 * hora, recusa o cartão de teste terminado em 0002 e guarda o estado no
 * Postgres (esquema local_gateway). O cartão fica pendente até a confirmação
 * pela rota dev (RN15), como o webhook do gateway real. Nunca sobe fora de
 * local e test: a barreira do construtor é a segunda, além do env.schema (RN16).
 */
export class LocalPaymentGateway implements PaymentGateway {
  readonly name = 'local' as const;

  constructor(
    private readonly store: LocalGatewayStore,
    private readonly options: { appEnv: AppEnv; webhookSecret: string },
  ) {
    if (!LOCAL_KEY_ENVS.includes(options.appEnv)) {
      throw new Error(`Gateway local recusado com APP_ENV ${options.appEnv}.`);
    }
  }

  async createCustomer({ name, taxId }: { name: string; taxId: string }) {
    await this.call();
    const customerId = await this.store.createCustomer({
      name,
      taxIdLast4: taxId.replace(/\D/g, '').slice(-4),
    });
    return { customerId };
  }

  async chargePix(input: {
    customerId: string;
    externalReference: string;
    amountCents: number;
    dueAt: Date;
  }): Promise<ChargeResult> {
    await this.call();
    const charge = await this.store.createCharge({
      externalReference: input.externalReference,
      customerId: input.customerId,
      method: 'pix',
      amountCents: input.amountCents,
      installments: 1,
      status: 'pending',
      pixCopyPaste: `00020126LOCALPIX${input.externalReference.replace(/-/g, '')}5204000053039865802BR`,
      dueAt: input.dueAt,
      cardLast4: null,
      failureReason: null,
    });
    return this.chargeResult(charge);
  }

  async chargeCard(input: {
    customerId: string;
    externalReference: string;
    amountCents: number;
    installments: number;
    cardToken: string | null;
  }): Promise<ChargeResult> {
    await this.call();
    const token = input.cardToken ?? '';
    const refused = token.endsWith(REFUSED_CARD_SUFFIX);
    const charge = await this.store.createCharge({
      externalReference: input.externalReference,
      customerId: input.customerId,
      method: 'card',
      amountCents: input.amountCents,
      installments: input.installments,
      status: refused ? 'refused' : 'pending',
      pixCopyPaste: null,
      dueAt: null,
      cardLast4: /\d{4}$/.test(token) ? token.slice(-4) : null,
      failureReason: refused ? 'card_declined' : null,
    });
    return this.chargeResult(charge);
  }

  async cancelCharge({ gatewayPaymentId }: { gatewayPaymentId: string }) {
    await this.call();
    const charge = await this.store.chargeById({ id: gatewayPaymentId });
    if (!charge) throw new Error('Gateway local: cobrança não encontrada.');
    if (charge.status === 'confirmed') return { result: 'already_paid' as const };
    if (charge.status === 'pending' || charge.status === 'overdue') {
      await this.store.updateCharge({ id: charge.id, status: 'canceled' });
    }
    return { result: 'canceled' as const };
  }

  /** O estorno local fica pedido; a rota dev confirma (refund) ou falha (refund-failed). */
  async refundCharge({ gatewayPaymentId }: { gatewayPaymentId: string }) {
    await this.call();
    const charge = await this.store.chargeById({ id: gatewayPaymentId });
    if (!charge) throw new Error('Gateway local: cobrança não encontrada.');
    if (charge.status === 'refunded') return { result: 'refunded' as const };
    return { result: 'requested' as const };
  }

  async getCharge({ externalReference }: { externalReference: string }) {
    await this.call();
    const charge = await this.store.chargeByReference({ externalReference });
    return charge ? this.toCharge(charge) : null;
  }

  async listCharges({ from, to }: { from: Date; to: Date }): Promise<GatewayCharge[]> {
    await this.call();
    return (await this.store.chargesCreatedBetween({ from, to })).map((row) => this.toCharge(row));
  }

  async sendPixTransfer(input: {
    externalReference: string;
    amountCents: number;
  }): Promise<GatewayTransfer> {
    await this.call();
    return this.toTransfer(await this.store.createTransfer(input));
  }

  async getPixTransfer({ externalReference }: { externalReference: string }) {
    await this.call();
    const transfer = await this.store.transferByReference({ externalReference });
    return transfer ? this.toTransfer(transfer) : null;
  }

  /** O segredo no cabeçalho, comparado em tempo constante (RN09). */
  verifyWebhook({
    headers,
    rawBody,
  }: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): WebhookVerification {
    const received = headers[LOCAL_WEBHOOK_TOKEN_HEADER];
    if (typeof received !== 'string' || !sameSecret(received, this.options.webhookSecret)) {
      return { kind: 'invalid_signature' };
    }
    let body: Partial<LocalWebhookBody>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Partial<LocalWebhookBody>;
    } catch {
      return { kind: 'malformed' };
    }
    if (
      typeof body.id !== 'string' ||
      body.id.length === 0 ||
      !GATEWAY_EVENT_TYPES.includes(body.type as GatewayEventType)
    ) {
      return { kind: 'malformed' };
    }
    return {
      kind: 'event',
      event: {
        gatewayEventId: body.id,
        type: body.type as GatewayEventType,
        externalReference: stringOrNull(body.externalReference),
        gatewayPaymentId: stringOrNull(body.gatewayPaymentId),
        chargedCents: integerOrNull(body.chargedCents),
        feeCents: integerOrNull(body.feeCents),
        netCents: integerOrNull(body.netCents),
      },
    };
  }

  async testConnection() {
    await this.store.ensureTables();
    return { ok: true };
  }

  /** A falha programada pela rota dev vale antes de qualquer efeito (RN15). */
  private async call(): Promise<void> {
    if (await this.store.consumeFailure()) throw new GatewayUnavailableError();
  }

  private chargeResult(charge: LocalChargeRow): ChargeResult {
    return {
      gatewayPaymentId: charge.id,
      outcome:
        charge.status === 'refused'
          ? 'refused'
          : charge.status === 'confirmed'
            ? 'confirmed'
            : 'pending',
      pixCopyPaste: charge.pix_copy_paste,
      dueAt: charge.due_at,
      cardLast4: charge.card_last4,
      failureReason: charge.failure_reason,
      nextAction: { type: 'none' },
    };
  }

  private toCharge(row: LocalChargeRow): GatewayCharge {
    return {
      gatewayPaymentId: row.id,
      externalReference: row.external_reference,
      status: row.status,
      chargedCents: row.charged_cents,
      feeCents: row.fee_cents,
      netCents: row.net_cents,
      cardLast4: row.card_last4,
      failureReason: row.failure_reason,
    };
  }

  private toTransfer(row: LocalTransferRow): GatewayTransfer {
    return {
      externalReference: row.external_reference,
      gatewayTransferId: row.id,
      status: row.status,
      failureReason: row.failure_reason,
    };
  }
}

/** Compara os resumos, de tamanho fixo: nem o tamanho do segredo vaza. */
function sameSecret(received: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}
