import type { CommissionRow } from '../../domain/commissions';

/**
 * As comissões da própria pessoa indicadora pela função `referrer_commissions()`
 * (Comissões do indicador RN07 e RN10), na transação da requisição.
 */
export interface ReferrerCommissionsReader {
  list(): Promise<CommissionRow[]>;
}

export const REFERRER_COMMISSIONS_READER = Symbol('ReferrerCommissionsReader');
