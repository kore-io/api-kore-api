import { commissionBalances, commissionsByWedding, type CommissionRow } from './commissions';

const row = (overrides: Partial<CommissionRow>): CommissionRow => ({
  id: 'c1',
  weddingId: 'w1',
  weddingPurged: false,
  partnerNames: ['Ana', 'Marcos'],
  clickable: true,
  paymentKind: 'publication',
  baseAmountCents: 33_710,
  amountCents: 6_742,
  ratePercent: 20,
  status: 'pending',
  availableAt: new Date('2026-09-09T12:00:00Z'),
  paidAt: null,
  createdAt: new Date('2026-08-10T12:00:00Z'),
  payoutId: null,
  ...overrides,
});

describe('Os saldos e a soma por casamento (Comissões do indicador RN02, RN07 e RN08)', () => {
  const rows = [
    row({ id: 'a', status: 'available', amountCents: 6_742 }),
    row({
      id: 'b',
      status: 'pending',
      amountCents: 1_740,
      availableAt: new Date('2026-10-10T12:00:00Z'),
    }),
    row({
      id: 'c',
      status: 'pending',
      amountCents: 1_000,
      availableAt: new Date('2026-10-02T12:00:00Z'),
    }),
    row({ id: 'd', status: 'paid', amountCents: 5_000 }),
    row({ id: 'e', status: 'available', amountCents: 3_000, payoutId: 'p1' }),
    row({ id: 'f', status: 'reversed', amountCents: 9_999 }),
    row({ id: 'g', status: 'blocked', amountCents: 9_999 }),
    row({ id: 'h', status: 'held', amountCents: 9_999 }),
    row({ id: 'i', weddingId: 'w2', status: 'available', amountCents: 500 }),
  ];

  it('RN02 e RN07 - disponível fora de repasse, aguardando, já recebido e em repasse; as outras fora', () => {
    expect(commissionBalances(rows)).toEqual({
      availableCents: 7_242,
      pendingCents: 2_740,
      receivedCents: 5_000,
      inPayoutCents: 3_000,
    });
  });

  it('RN07 e RN08 - por casamento: a soma e as datas de liberação em ordem', () => {
    const [first, second] = commissionsByWedding(rows);
    expect(first).toMatchObject({ weddingId: 'w1', availableCents: 6_742, pendingCents: 2_740 });
    expect(first.releaseDates.map((date) => date.toISOString().slice(0, 10))).toEqual([
      '2026-10-02',
      '2026-10-10',
    ]);
    expect(second).toMatchObject({ weddingId: 'w2', availableCents: 500, pendingCents: 0 });
  });
});
