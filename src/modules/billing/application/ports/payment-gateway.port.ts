/**
 * Porta do gateway de pagamento (Publicar e pagar RN14; revisão técnica
 * B2-15). Os tipos são fixos e do Kore: cada adaptador traduz o gateway para
 * eles. Toda chamada acontece fora de transação, depois do commit do estado
 * que a registra (RN19).
 */

/** Resultado de uma cobrança nova (RN14). */
export type ChargeOutcome = 'pending' | 'confirmed' | 'refused';

/**
 * O estado de uma cobrança na consulta (RN09: o webhook é gatilho, a consulta
 * é a fonte). `overdue` é o Pix vencido ainda não cancelado.
 */
export type GatewayChargeStatus =
  | 'pending'
  | 'overdue'
  | 'confirmed'
  | 'refused'
  | 'canceled'
  | 'refunded'
  | 'refund_failed'
  | 'disputed'
  | 'dispute_lost';

/** Uma cobrança como o gateway a vê, com o total normalizado (nunca a parcela; B2-7). */
export interface GatewayCharge {
  gatewayPaymentId: string;
  externalReference: string;
  status: GatewayChargeStatus;
  /** O total cobrado, somadas as parcelas. Nulo enquanto não confirmado. */
  chargedCents: number | null;
  feeCents: number | null;
  netCents: number | null;
  cardLast4: string | null;
  /** Por que o cartão foi recusado ou o estorno falhou, sem dado pessoal. */
  failureReason: string | null;
  /** O prazo da defesa na contestação, AAAA-MM-DD (Pagamentos e arrependimento RN06). */
  disputeDeadline: string | null;
}

/** O que o cartão pede depois da cobrança (B2-16): nada, ou o checkout hospedado. */
export type NextAction = { type: 'none' } | { type: 'redirect'; url: string };

export interface ChargeResult {
  gatewayPaymentId: string;
  outcome: ChargeOutcome;
  /** Pix: o copia e cola e o vencimento. */
  pixCopyPaste: string | null;
  dueAt: Date | null;
  cardLast4: string | null;
  failureReason: string | null;
  nextAction: NextAction;
}

export type GatewayTransferStatus = 'processing' | 'paid' | 'failed';

export interface GatewayTransfer {
  externalReference: string;
  gatewayTransferId: string;
  status: GatewayTransferStatus;
  failureReason: string | null;
}

/** Tipo do evento do webhook, já traduzido (RN09; B2-15). */
export const GATEWAY_EVENT_TYPES = [
  'charge.confirmed',
  'charge.received',
  'charge.refused',
  'charge.overdue',
  'charge.canceled',
  'charge.refunded',
  'charge.refund_failed',
  'charge.disputed',
  'charge.dispute_won',
  'charge.dispute_lost',
  'transfer.paid',
  'transfer.failed',
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

/**
 * O evento normalizado (B2-15). É também a lista de campos permitidos do
 * `GatewayEvent.payload` (RN02; B2-13): nada de nome, CPF ou cartão.
 */
export interface GatewayWebhookEvent {
  gatewayEventId: string;
  type: GatewayEventType;
  externalReference: string | null;
  gatewayPaymentId: string | null;
  chargedCents: number | null;
  feeCents: number | null;
  netCents: number | null;
}

/** O webhook conferido: assinatura inválida, corpo que não se entende, ou o evento. */
export type WebhookVerification =
  | { kind: 'invalid_signature' }
  | { kind: 'malformed' }
  | { kind: 'event'; event: GatewayWebhookEvent };

/** O gateway não respondeu (timeout, rede, 5xx): quem chama decide tentar de novo. */
export class GatewayUnavailableError extends Error {
  constructor(message = 'O gateway de pagamento não respondeu.') {
    super(message);
    this.name = 'GatewayUnavailableError';
  }
}

export interface PaymentGateway {
  readonly name: 'local' | 'asaas';

  /** O cliente do pagador (B2-11). O CPF inteiro só vai ao gateway (RN02). */
  createCustomer(input: { name: string; taxId: string }): Promise<{ customerId: string }>;

  chargePix(input: {
    customerId: string;
    externalReference: string;
    amountCents: number;
    dueAt: Date;
    description: string;
  }): Promise<ChargeResult>;

  /** O total já com os juros de 7x a 12x; o gateway divide (Preço RN01). */
  chargeCard(input: {
    customerId: string;
    externalReference: string;
    amountCents: number;
    installments: number;
    cardToken: string | null;
    description: string;
  }): Promise<ChargeResult>;

  /** Cancelar o Pix pendente (RN07): se já foi pago, diz que já foi pago. */
  cancelCharge(input: {
    gatewayPaymentId: string;
  }): Promise<{ result: 'canceled' | 'already_paid' }>;

  /** Pedir o estorno do total (Pagamentos e arrependimento RN04). */
  refundCharge(input: { gatewayPaymentId: string }): Promise<{ result: 'requested' | 'refunded' }>;

  /** A consulta pela referência do Kore, que vale mesmo sem o id do gateway (B2-1). */
  getCharge(input: { externalReference: string }): Promise<GatewayCharge | null>;

  /** As cobranças criadas no período, para a reconciliação diária (RN11). */
  listCharges(input: { from: Date; to: Date }): Promise<GatewayCharge[]>;

  /** Pix de saída idempotente pela referência do repasse (Repasse RN05). */
  sendPixTransfer(input: {
    externalReference: string;
    amountCents: number;
    pixKey: string;
    pixKeyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  }): Promise<GatewayTransfer>;

  getPixTransfer(input: { externalReference: string }): Promise<GatewayTransfer | null>;

  verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): WebhookVerification;

  /** Backoffice › Configurações › Testar a conexão (Backoffice - cobrança). */
  testConnection(): Promise<{ ok: boolean }>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
