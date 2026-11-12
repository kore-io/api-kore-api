import type { GatewayChargeStatus, GatewayEventType } from './ports/payment-gateway.port';

/** Os eventos da rota dev (Publicar e pagar RN15; B2-15). */
export const DEV_PAYMENT_EVENTS = [
  'confirm',
  'fail',
  'refund',
  'refund-failed',
  'dispute',
  'dispute-won',
  'dispute-lost',
  'pix-expired',
  'payout-paid',
  'payout-failed',
] as const;
export type DevPaymentEvent = (typeof DEV_PAYMENT_EVENTS)[number];

/** Cada evento de cobrança: o novo estado no gateway local e o evento do webhook. */
export const DEV_CHARGE_EVENTS: Record<
  Exclude<DevPaymentEvent, 'payout-paid' | 'payout-failed'>,
  { status: GatewayChargeStatus; type: GatewayEventType }
> = {
  confirm: { status: 'confirmed', type: 'charge.confirmed' },
  fail: { status: 'refused', type: 'charge.refused' },
  refund: { status: 'refunded', type: 'charge.refunded' },
  'refund-failed': { status: 'refund_failed', type: 'charge.refund_failed' },
  dispute: { status: 'disputed', type: 'charge.disputed' },
  'dispute-won': { status: 'confirmed', type: 'charge.dispute_won' },
  'dispute-lost': { status: 'dispute_lost', type: 'charge.dispute_lost' },
  'pix-expired': { status: 'overdue', type: 'charge.overdue' },
};
