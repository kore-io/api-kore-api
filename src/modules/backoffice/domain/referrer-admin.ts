/**
 * As ações do Admin na cerimonialista (Backoffice - cobrança RN08; decisões
 * 68, 74 e 230 D15; revisões técnicas B6-7, B10-4 e B10-7).
 */
export type CommissionStatus = 'pending' | 'available' | 'paid' | 'reversed' | 'blocked' | 'held';

/**
 * B10-4: só a pendente e a disponível se bloqueiam, fora de repasse ou num
 * repasse pedido ou retido. A de um repasse em processamento ou pago segue o
 * Pix (Repasse B6-4): bloqueá-la a deixaria presa a um repasse pago.
 */
export const isCommissionBlockable = ({
  status,
  payoutStatus = null,
}: {
  status: CommissionStatus;
  payoutStatus?: string | null;
}) =>
  (status === 'pending' || status === 'available') &&
  (payoutStatus === null || payoutStatus === 'requested' || payoutStatus === 'held');

/**
 * Desbloquear: a comissão volta a seguir o prazo de liberação; com o pagamento
 * ainda em disputa ou em estorno, vai a `held` e segue o desfecho dele
 * (decisão 290(4); Comissões RN05 e RN06).
 */
export const unblockedStatus = ({
  availableAt,
  paymentStatus,
  now,
}: {
  availableAt: Date;
  paymentStatus: string;
  now: Date;
}): 'pending' | 'available' | 'held' => {
  if (paymentStatus === 'disputed' || paymentStatus === 'refund_requested') return 'held';
  return availableAt.getTime() <= now.getTime() ? 'available' : 'pending';
};

/**
 * B10-7: o ajuste positivo acima de R$ 500,00 abre o Alert `manual_adjustment`
 * (enquanto houver um Admin só).
 */
export const MANUAL_ADJUSTMENT_ALERT_CENTS = 50_000;
export const opensManualAdjustmentAlert = ({ amountCents }: { amountCents: number }) =>
  amountCents > MANUAL_ADJUSTMENT_ALERT_CENTS;

export class ReferrerNotFoundError extends Error {
  override name = 'ReferrerNotFoundError';
}

export class CommissionNotFoundError extends Error {
  override name = 'CommissionNotFoundError';
}

/** 409 COMMISSION_NOT_BLOCKABLE: paga, estornada, retida ou já bloqueada (e, no desbloqueio, a que não está bloqueada). */
export class CommissionNotBlockableError extends Error {
  override name = 'CommissionNotBlockableError';
  constructor(readonly status: CommissionStatus) {
    super();
  }
}

export class ReferrerTaxIdInUseError extends Error {
  override name = 'ReferrerTaxIdInUseError';
}

export class InvalidReferrerTaxIdError extends Error {
  override name = 'InvalidReferrerTaxIdError';
}

export class ReferrerAlreadyBlockedError extends Error {
  override name = 'ReferrerAlreadyBlockedError';
}

export class ReferrerNotBlockedError extends Error {
  override name = 'ReferrerNotBlockedError';
}
