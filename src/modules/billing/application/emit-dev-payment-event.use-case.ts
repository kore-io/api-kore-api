import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  LOCAL_WEBHOOK_TOKEN_HEADER,
  type LocalWebhookBody,
} from '../infrastructure/backoffice/local-gateway/local-payment-gateway';
import { LocalGatewayStore } from '../infrastructure/backoffice/local-gateway/local-gateway.store';
import { DEV_CHARGE_EVENTS, type DevPaymentEvent } from './dev-payment-events';
import { ProcessGatewayEvent } from './process-gateway-event.use-case';
import { ReceiveGatewayWebhook } from './receive-gateway-webhook.use-case';

export type DevEventResult =
  { kind: 'not_found' } | { kind: 'emitted'; gatewayEventId: string; deliveries: number };

/**
 * A rota dev (Publicar e pagar RN15; RN21): muda o estado no gateway local e
 * dispara o mesmo evento que o webhook mandaria, pelo mesmo caminho (grava o
 * GatewayEvent e vai à fila). `repeat` reenvia o mesmo evento (mesmo id). Em
 * seguida processa em linha e só então responde, para o teste e o Bruno
 * verem o efeito sem esperar a fila; o job da fila acha o evento processado.
 * `failNextGatewayCall`: a próxima chamada à porta sobre este pagamento (ou
 * repasse) não responde (B2-15); com o escopo, o teste e o Bruno não atingem
 * as chamadas de outro pagamento.
 */
@Injectable()
export class EmitDevPaymentEvent {
  constructor(
    private readonly store: LocalGatewayStore,
    private readonly receive: ReceiveGatewayWebhook,
    private readonly processEvent: ProcessGatewayEvent,
    private readonly config: AppConfigService,
  ) {}

  async execute({
    id,
    event,
    amountCents,
    repeat = 1,
    failNextGatewayCall = false,
    now,
  }: {
    /** O Payment (eventos de cobrança) ou o Payout (payout-*), pela referência. */
    id: string;
    event: DevPaymentEvent;
    amountCents?: number;
    repeat?: number;
    failNextGatewayCall?: boolean;
    now: Date;
  }): Promise<DevEventResult> {
    const body = await this.applyToGateway({ id, event, amountCents });
    if (!body) return { kind: 'not_found' };

    const eventIds = new Set<string>();
    for (let delivery = 0; delivery < repeat; delivery++) {
      const receipt = await this.receive.execute({
        gateway: 'local',
        headers: {
          [LOCAL_WEBHOOK_TOKEN_HEADER]: this.config.get({ key: 'PAYMENT_WEBHOOK_SECRET' }),
        },
        rawBody: Buffer.from(JSON.stringify(body)),
        now,
      });
      if (receipt.kind !== 'recorded') throw new Error(`Rota dev: webhook ${receipt.kind}.`);
      eventIds.add(receipt.eventId);
      for (const eventId of eventIds) await this.processEvent.execute({ eventId, now });
    }
    if (failNextGatewayCall) await this.store.failNextCalls({ count: 1, scope: id });
    return { kind: 'emitted', gatewayEventId: body.id, deliveries: repeat };
  }

  private async applyToGateway({
    id,
    event,
    amountCents,
  }: {
    id: string;
    event: DevPaymentEvent;
    amountCents?: number;
  }): Promise<LocalWebhookBody | null> {
    const eventId = `evt_local_${randomUUID()}`;
    if (event === 'payout-paid' || event === 'payout-failed') {
      const transfer = await this.store.transferByReference({ externalReference: id });
      if (!transfer) return null;
      const paid = event === 'payout-paid';
      await this.store.updateTransfer({
        externalReference: id,
        status: paid ? 'paid' : 'failed',
        failureReason: paid ? null : 'pix_key_not_found',
      });
      return {
        id: eventId,
        type: paid ? 'transfer.paid' : 'transfer.failed',
        externalReference: id,
        gatewayPaymentId: transfer.id,
        chargedCents: null,
        feeCents: null,
        netCents: null,
      };
    }
    const charge = await this.store.chargeByReference({ externalReference: id });
    if (!charge) return null;
    const { status, type } = DEV_CHARGE_EVENTS[event];
    const confirming = event === 'confirm';
    await this.store.updateCharge({
      id: charge.id,
      status,
      chargedCents: confirming ? (amountCents ?? charge.amount_cents) : undefined,
      failureReason:
        event === 'fail' ? 'card_declined' : event === 'refund-failed' ? 'refund_refused' : null,
    });
    const updated = await this.store.chargeById({ id: charge.id });
    return {
      id: eventId,
      type,
      externalReference: charge.external_reference,
      gatewayPaymentId: charge.id,
      chargedCents: updated?.charged_cents ?? null,
      feeCents: updated?.fee_cents ?? null,
      netCents: updated?.net_cents ?? null,
    };
  }
}
