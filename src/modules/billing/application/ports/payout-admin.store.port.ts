/** As abas da fila de Repasses (Backoffice - cobrança RN09). */
export const PAYOUT_QUEUE_TABS = ['requested', 'held', 'history'] as const;
export type PayoutQueueTab = (typeof PAYOUT_QUEUE_TABS)[number];

export interface PayoutQueueRow {
  id: string;
  status: 'requested' | 'held' | 'processing' | 'paid' | 'rejected';
  referrer: { id: string; kind: 'planner' | 'seller'; name: string };
  amountCents: number;
  /** A chave do pedido, mascarada. */
  pixKeyMasked: string;
  requestedAt: Date;
  holdReason: string | null;
  /** O que segura o repasse: as comissões estornadas, em estorno, em contestação ou bloqueadas. */
  heldCommissions: { coupleNames: string | null; amountCents: number; status: string }[];
  /** A troca da chave que ainda não vale: quando vale. */
  pixKeyActiveFrom: Date | null;
  /** O valor do Liberar: sem as comissões estornadas e bloqueadas, com os ajustes. */
  releaseAmountCents: number | null;
  processingAt: Date | null;
  lastError: string | null;
  paidAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
}

export type RejectResult =
  | { result: 'rejected'; referrerUserId: string }
  | { result: 'not_found' }
  | { result: 'conflict'; status: string };

export type ReleaseResult =
  | { result: 'released'; amountCents: number }
  | { result: 'not_found' }
  | { result: 'conflict'; status: string }
  | { result: 'referrer_blocked' }
  | { result: 'pix_key_change_pending' }
  | { result: 'still_held' }
  | { result: 'below_minimum'; amountCents: number; minimumCents: number };

/**
 * A fila de Repasses do Admin (Backoffice - cobrança RN09), na transação
 * corrente da BackofficeTransaction, com a ordem única de trava (Referrer →
 * Payout → Commission; Publicar e pagar RN18).
 */
export interface PayoutAdminStore {
  queue(input: { tab: PayoutQueueTab; referrerId?: string; page: number }): Promise<{
    items: PayoutQueueRow[];
    total: number;
    pageSize: number;
  }>;
  /** Recusar: as comissões e os ajustes saem do pedido, que não conta para os 30 dias. */
  reject(input: {
    payoutId: string;
    byUserId: string;
    reason: string;
    now: Date;
  }): Promise<RejectResult>;
  /**
   * Liberar o retido: sem as comissões estornadas e bloqueadas (que saem do
   * pedido), a partir do repasse mínimo; volta a Solicitado.
   */
  release(input: { payoutId: string; byUserId: string; now: Date }): Promise<ReleaseResult>;
}

export const PAYOUT_ADMIN_STORE = Symbol('PayoutAdminStore');
