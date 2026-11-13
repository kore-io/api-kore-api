import { afterRefundFailure, REFUND_MAX_ATTEMPTS } from './refund-attempts';

describe('As tentativas do estorno (Pagamentos e arrependimento RN05; B3-2)', () => {
  it('RN05 - depois da 1ª, 2ª e 3ª falha: de novo em 1 h, 6 h e 24 h', () => {
    expect(afterRefundFailure({ attempts: 1 })).toEqual({
      kind: 'retry',
      attempt: 2,
      delayMs: 3_600_000,
    });
    expect(afterRefundFailure({ attempts: 2 })).toEqual({
      kind: 'retry',
      attempt: 3,
      delayMs: 21_600_000,
    });
    expect(afterRefundFailure({ attempts: 3 })).toEqual({
      kind: 'retry',
      attempt: 4,
      delayMs: 86_400_000,
    });
  });

  it('RN05 - depois da 4ª chamada, desiste (o Admin resolve)', () => {
    expect(REFUND_MAX_ATTEMPTS).toBe(4);
    expect(afterRefundFailure({ attempts: 4 })).toEqual({ kind: 'give_up' });
  });
});
