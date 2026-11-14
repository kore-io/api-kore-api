import {
  isCommissionBlockable,
  opensManualAdjustmentAlert,
  unblockedStatus,
} from './referrer-admin';

describe('Ações na cerimonialista (Backoffice - cobrança RN08)', () => {
  it('RN08 (B10-4) - bloqueia a pendente e a disponível; a paga, a estornada, a retida e a bloqueada não', () => {
    expect(isCommissionBlockable({ status: 'pending' })).toBe(true);
    expect(isCommissionBlockable({ status: 'available' })).toBe(true);
    for (const status of ['paid', 'reversed', 'held', 'blocked'] as const)
      expect(isCommissionBlockable({ status })).toBe(false);
  });

  it('RN08 - desbloquear volta ao prazo de liberação', () => {
    const now = new Date('2026-11-14T12:00:00Z');
    expect(unblockedStatus({ availableAt: new Date('2026-11-01T00:00:00Z'), now })).toBe(
      'available',
    );
    expect(unblockedStatus({ availableAt: new Date('2026-12-01T00:00:00Z'), now })).toBe('pending');
  });

  it('RN08 (B10-7) - o ajuste positivo acima de R$ 500,00 abre o alerta; o de R$ 500,00 e o negativo não', () => {
    expect(opensManualAdjustmentAlert({ amountCents: 50_001 })).toBe(true);
    expect(opensManualAdjustmentAlert({ amountCents: 50_000 })).toBe(false);
    expect(opensManualAdjustmentAlert({ amountCents: -90_000 })).toBe(false);
  });
});
