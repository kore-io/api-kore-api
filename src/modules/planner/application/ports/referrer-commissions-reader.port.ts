import type { AdjustmentRow, CommissionRow } from '../../domain/commissions';

/**
 * As comissões da própria pessoa indicadora pela função `referrer_commissions()`
 * (Comissões do indicador RN07 e RN10), na transação da requisição.
 */
export interface ReferrerCommissionsReader {
  list(): Promise<CommissionRow[]>;
  /** Os ajustes da própria pessoa indicadora (RLS por referrerId; RN02). */
  adjustments(): Promise<AdjustmentRow[]>;
}

export const REFERRER_COMMISSIONS_READER = Symbol('ReferrerCommissionsReader');
