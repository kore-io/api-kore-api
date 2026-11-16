import type { CommissionStatus } from '@/modules/backoffice/domain/referrer-admin';

export interface LockedReferrer {
  id: string;
  userId: string;
  status: 'active' | 'blocked' | 'inactive';
  userStatus: 'active' | 'blocked';
}

export interface LockedCommission {
  id: string;
  referrerId: string;
  status: CommissionStatus;
  amountCents: number;
  availableAt: Date;
  payoutId: string | null;
  /** O estado do repasse dela, travado antes da comissão (G2). */
  payoutStatus: 'requested' | 'held' | 'processing' | 'paid' | 'rejected' | null;
}

/**
 * As escritas das ações do Admin na cerimonialista (Backoffice - cobrança
 * RN08), pelo kore_backoffice, na transação corrente, com os logs. A ordem de
 * trava é Referrer, depois Commission e Payout (G2).
 */
export interface ReferrerAdminStore {
  lockReferrer(input: { referrerId: string }): Promise<LockedReferrer | null>;
  /** Trava o Referrer da comissão, o repasse dela e depois a comissão (G2). */
  lockCommission(input: { commissionId: string }): Promise<LockedCommission | null>;

  /**
   * O User e o Referrer bloqueados, as sessões encerradas, o repasse pedido
   * retido (`referrer_blocked`) e o log `referrer.blocked`.
   */
  blockReferrer(input: {
    referrer: LockedReferrer;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutIds: string[] }>;
  /** O User e o Referrer ativos de novo e o log `referrer.unblocked`. */
  unblockReferrer(input: {
    referrer: LockedReferrer;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void>;

  /** A comissão bloqueada (`admin`), o repasse pedido dela retido e o log `commission.blocked`. */
  blockCommission(input: {
    commission: LockedCommission;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<{ heldPayoutId: string | null }>;
  unblockCommission(input: {
    commission: LockedCommission;
    status: 'pending' | 'available';
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<void>;

  /** O CommissionAdjustment manual, o log `commission.adjusted` e, se pedido, o Alert. */
  addAdjustment(input: {
    referrerId: string;
    amountCents: number;
    reason: string;
    adminUserId: string;
    openAlert: boolean;
    now: Date;
  }): Promise<{ adjustmentId: string }>;

  /**
   * O documento novo e, na mesma transação, a autoindicação de novo nas
   * comissões pendentes e disponíveis (o repasse pedido com uma delas fica
   * retido) e o log `referrer.tax_id_corrected`, sem o documento.
   */
  correctTaxId(input: {
    referrerId: string;
    type: 'cpf' | 'cnpj';
    encrypted: string;
    hash: string;
    version: number;
    adminUserId: string;
    reason: string;
    now: Date;
  }): Promise<'ok' | 'in_use'>;
}

export const REFERRER_ADMIN_STORE = Symbol('ReferrerAdminStore');
