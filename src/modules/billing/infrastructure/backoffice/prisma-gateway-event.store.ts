import { Injectable } from '@nestjs/common';
import { BackofficePrismaService } from '../../../../shared/database/backoffice-prisma.service';
import type {
  GatewayEventStore,
  StoredGatewayEvent,
} from '../../application/ports/gateway-event.store.port';
import type { GatewayWebhookEvent } from '../../application/ports/payment-gateway.port';

/** Os campos permitidos do payload (RN02; B2-13): o evento normalizado, sem dado pessoal. */
function allowedPayload(event: GatewayWebhookEvent) {
  return {
    type: event.type,
    externalReference: event.externalReference,
    gatewayPaymentId: event.gatewayPaymentId,
    chargedCents: event.chargedCents,
    feeCents: event.feeCents,
    netCents: event.netCents,
  };
}

@Injectable()
export class PrismaGatewayEventStore implements GatewayEventStore {
  constructor(private readonly db: BackofficePrismaService) {}

  async record({
    gateway,
    event,
    now,
  }: {
    gateway: 'local' | 'asaas';
    event: GatewayWebhookEvent;
    now: Date;
  }) {
    const inserted = await this.db.gatewayEvent.createManyAndReturn({
      data: [
        {
          gateway,
          gatewayEventId: event.gatewayEventId,
          type: event.type,
          payload: allowedPayload(event),
          receivedAt: now,
        },
      ],
      skipDuplicates: true,
      select: { id: true, processedAt: true },
    });
    if (inserted[0]) return { ...inserted[0], created: true };
    const existing = await this.db.gatewayEvent.findUniqueOrThrow({
      where: { gateway_gatewayEventId: { gateway, gatewayEventId: event.gatewayEventId } },
      select: { id: true, processedAt: true },
    });
    return { ...existing, created: false };
  }

  async byId({ id }: { id: string }): Promise<StoredGatewayEvent | null> {
    const row = await this.db.gatewayEvent.findUnique({ where: { id } });
    if (!row) return null;
    const payload = row.payload as Omit<GatewayWebhookEvent, 'gatewayEventId'>;
    return {
      id: row.id,
      gateway: row.gateway,
      gatewayEventId: row.gatewayEventId,
      processedAt: row.processedAt,
      event: { ...payload, gatewayEventId: row.gatewayEventId },
    };
  }

  unprocessed({ receivedBefore, limit }: { receivedBefore: Date; limit: number }) {
    return this.db.gatewayEvent.findMany({
      where: { processedAt: null, receivedAt: { lt: receivedBefore } },
      orderBy: { receivedAt: 'asc' },
      take: limit,
      select: { id: true, gateway: true, gatewayEventId: true },
    });
  }

  async paymentIdFor({
    externalReference,
    gatewayPaymentId,
  }: {
    externalReference: string | null;
    gatewayPaymentId: string | null;
  }): Promise<string | null> {
    if (!externalReference && !gatewayPaymentId) return null;
    const payment = await this.db.payment.findFirst({
      where: {
        OR: [
          ...(externalReference ? [{ externalReference }] : []),
          ...(gatewayPaymentId ? [{ gatewayPaymentId }] : []),
        ],
      },
      select: { id: true },
    });
    return payment?.id ?? null;
  }

  async markProcessed({
    id,
    paymentId,
    result,
    now,
  }: {
    id: string;
    paymentId: string | null;
    result: string;
    now: Date;
  }): Promise<void> {
    await this.db.gatewayEvent.updateMany({
      where: { id, processedAt: null },
      data: { processedAt: now, paymentId, result },
    });
  }
}
