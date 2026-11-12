/**
 * A fila do processamento dos eventos (Publicar e pagar RN09): o job tem id
 * fixo pelo evento do gateway, então o mesmo evento não entra duas vezes.
 */
export interface GatewayEventQueue {
  enqueue(input: {
    eventId: string;
    gateway: 'local' | 'asaas';
    gatewayEventId: string;
  }): Promise<void>;
}

export const GATEWAY_EVENT_QUEUE = Symbol('GatewayEventQueue');
