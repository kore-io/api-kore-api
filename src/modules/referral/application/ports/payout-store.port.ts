export interface PayoutRow {
  id: string;
  amountCents: number;
  status: 'requested' | 'held' | 'processing' | 'paid' | 'rejected';
  holdReason:
    'refund' | 'pix_key_change' | 'referrer_blocked' | 'dispute' | 'commission_blocked' | null;
  pixKeyMasked: string;
  requestedAt: Date;
  paidAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
}

export type PayoutRequestResult =
  | { result: 'created' | 'existing'; payoutId: string; amountCents: number }
  | { result: 'key_reused' | 'no_referrer' | 'data_missing' }
  | { result: 'change_pending'; activeFrom: Date }
  | { result: 'payout_open'; payoutId: string }
  | { result: 'too_soon'; nextRequestAt: Date }
  | { result: 'below_minimum' | 'amount_changed'; amountCents: number };

/**
 * Os repasses da própria pessoa indicadora (Repasse RN04 e RN09), na transação
 * da requisição: lê pela RLS e pede pela função `request_referrer_payout`.
 */
export interface PayoutStore {
  /** Tem o perfil de cerimonialista ativo (decisão 247(5)). */
  isPlanner({ userId }: { userId: string }): Promise<boolean>;
  request(input: {
    id: string;
    idempotencyKey: string;
    expectedCents: number;
    externalRef: string;
    now: Date;
  }): Promise<PayoutRequestResult>;
  /** Do mais novo para o mais antigo. */
  list(): Promise<PayoutRow[]>;
  /** O mínimo das Configurações (`payoutMinCents`). */
  minimumCents(): Promise<number>;
}

export const PAYOUT_STORE = Symbol('PayoutStore');
