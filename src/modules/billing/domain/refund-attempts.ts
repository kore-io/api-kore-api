/**
 * As tentativas do estorno (Pagamentos e arrependimento RN05; B3-2): a 1ª
 * chamada e mais 3, em 1 h, 6 h e 24 h (4 chamadas no total). Depois da última,
 * o pagamento fica em `refund_requested` e o Admin resolve.
 */
export const REFUND_MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

export type RefundFailureDecision =
  { kind: 'retry'; attempt: number; delayMs: number } | { kind: 'give_up' };

/** Depois da falha da tentativa `attempts` (1 a 4): tentar de novo, e quando, ou desistir. */
export function afterRefundFailure({ attempts }: { attempts: number }): RefundFailureDecision {
  if (attempts >= REFUND_MAX_ATTEMPTS) return { kind: 'give_up' };
  return {
    kind: 'retry',
    attempt: attempts + 1,
    delayMs: RETRY_DELAYS_MS[Math.max(0, attempts - 1)],
  };
}
