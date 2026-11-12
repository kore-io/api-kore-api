import type { GatewayWebhookEvent } from './payment-gateway.port';

export interface StoredGatewayEvent {
  id: string;
  gateway: 'local' | 'asaas';
  gatewayEventId: string;
  event: GatewayWebhookEvent;
  processedAt: Date | null;
}

/**
 * Os eventos do webhook gravados (Publicar e pagar RN09), pela conexão do
 * backoffice: sem GRANT ao kore_app (RN20).
 */
export interface GatewayEventStore {
  /**
   * Grava o evento uma vez por gateway e id (o único da tabela). O payload é
   * só o evento normalizado, a lista de campos permitidos (RN02; B2-13).
   */
  record(input: {
    gateway: 'local' | 'asaas';
    event: GatewayWebhookEvent;
    now: Date;
  }): Promise<{ id: string; created: boolean; processedAt: Date | null }>;

  byId({ id }: { id: string }): Promise<StoredGatewayEvent | null>;

  /** Os gravados e não processados, recebidos antes de `receivedBefore` (B2-5). */
  unprocessed({
    receivedBefore,
    limit,
  }: {
    receivedBefore: Date;
    limit: number;
  }): Promise<{ id: string; gateway: 'local' | 'asaas'; gatewayEventId: string }[]>;

  /** O pagamento do evento, pela referência do Kore ou pelo id do gateway (B2-1). */
  paymentIdFor(input: {
    externalReference: string | null;
    gatewayPaymentId: string | null;
  }): Promise<string | null>;

  markProcessed(input: {
    id: string;
    paymentId: string | null;
    result: string;
    now: Date;
  }): Promise<void>;
}

export const GATEWAY_EVENT_STORE = Symbol('GatewayEventStore');
