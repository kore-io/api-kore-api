import type { PixKeyType } from '../../../referral/domain/payout-data';

/** O repasse travado, com o que o Pagar confere (Repasse RN05; B7-3). */
export interface LockedPayout {
  id: string;
  status: 'requested' | 'held' | 'processing' | 'paid' | 'rejected';
  amountCents: number;
  externalRef: string;
  referrerId: string;
  referrerUserId: string;
  referrerStatus: 'active' | 'blocked' | 'inactive';
  /** Uma troca da chave confirmada que ainda não vale. */
  pixKeyChangePending: boolean;
  /** A soma das comissões não estornadas e dos ajustes do repasse. */
  itemsCents: number;
  pixKey: { type: PixKeyType; encrypted: string };
}

/**
 * As escritas do repasse pelo worker e pelo backoffice (kore_backoffice), na
 * transação corrente da BackofficeTransaction (Repasse RN05 a RN08).
 */
export interface PayoutLedger {
  /** Trava o Referrer e depois o Payout (a ordem de trava, G2). Nulo: não existe. */
  lock(input: { payoutId: string }): Promise<LockedPayout | null>;
  /**
   * requested → processing, com quem tocou em Pagar (o commit vem antes do Pix;
   * G1), e o log `payout.processing` com o valor, o indicador e a chave de
   * idempotência (Backoffice - cobrança RN01; D19).
   */
  markProcessing(input: {
    payoutId: string;
    paidByUserId: string;
    idempotencyKey: string;
    now: Date;
  }): Promise<void>;
  /** Este Pagar já passou com esta chave (o replay; decisão 259(3)). */
  paidWithKey(input: { payoutId: string; idempotencyKey: string }): Promise<boolean>;
  /** O log `payout.retried`: quem tentou, o que a consulta achou e o resultado (RN01). */
  recordRetry(input: {
    payoutId: string;
    adminUserId: string;
    gatewayStatus: string;
    result: string;
    now: Date;
  }): Promise<void>;
  /**
   * processing → paid: as comissões ficam pagas; a estornada durante o Pix
   * (B6-4) também, e ganha o ajuste negativo do mesmo valor.
   */
  markPaid(input: { payoutId: string; transferId: string; now: Date }): Promise<void>;
  /**
   * Falha definitiva: processing → requested, com o motivo; a comissão
   * estornada durante o Pix vira reversed (e o repasse fica retido, RN06 (a)).
   */
  markFailed(input: { payoutId: string; reason: string; now: Date }): Promise<void>;
  /** Sem resposta do gateway: fica processing, só com o erro (B7-2). */
  markStuck(input: { payoutId: string; error: string; now: Date }): Promise<void>;
  /** O alerta `payout_failed`, um aberto por repasse. */
  openFailedAlert(input: { payoutId: string; reason: string }): Promise<void>;
  /** Os repasses em processamento, para a conciliação diária. */
  processingPayoutIds(input: { payoutId?: string }): Promise<string[]>;
  /** O repasse da referência externa (o webhook do Pix de saída). */
  payoutIdByReference(input: { externalRef: string }): Promise<string | null>;
  /** Para os e-mails: o e-mail e o primeiro nome de quem indicou. */
  recipient(input: { userId: string }): Promise<{ email: string; firstName: string | null }>;
}

export const PAYOUT_LEDGER = Symbol('PayoutLedger');
