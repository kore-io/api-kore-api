/**
 * As ações do Admin na cerimonialista (Backoffice - cobrança RN08; decisões
 * 68, 74 e 230 D15; revisões técnicas B6-7, B10-4 e B10-7).
 */
export type CommissionStatus = 'pending' | 'available' | 'paid' | 'reversed' | 'blocked' | 'held';

/** B10-4: só a pendente e a disponível (dentro ou fora de um repasse) se bloqueiam. */
export const isCommissionBlockable = ({ status }: { status: CommissionStatus }) =>
  status === 'pending' || status === 'available';

/** Desbloquear: a comissão volta a seguir o prazo de liberação. */
export const unblockedStatus = ({
  availableAt,
  now,
}: {
  availableAt: Date;
  now: Date;
}): 'pending' | 'available' => (availableAt.getTime() <= now.getTime() ? 'available' : 'pending');

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
