import {
  availableAdjustmentsCents,
  commissionBalances,
  commissionPaymentLines,
  commissionsByWedding,
  type CommissionRow,
} from './commissions';

const row = (overrides: Partial<CommissionRow>): CommissionRow => ({
  id: 'c1',
  weddingId: 'w1',
  weddingPurged: false,
  partnerNames: ['Ana', 'Marcos'],
  clickable: true,
  paymentKind: 'publication',
  referralSource: 'referral_link',
  baseAmountCents: 33_710,
  amountCents: 6_742,
  ratePercent: 20,
  status: 'pending',
  availableAt: new Date('2026-09-09T12:00:00Z'),
  paidAt: null,
  createdAt: new Date('2026-08-10T12:00:00Z'),
  payoutId: null,
  blockReason: null,
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
    const [first, second] = commissionsByWedding({ rows });
    expect(first).toMatchObject({ weddingId: 'w1', availableCents: 6_742, pendingCents: 2_740 });
    expect(first.releaseDates.map((date) => date.toISOString().slice(0, 10))).toEqual([
      '2026-10-02',
      '2026-10-10',
    ]);
    expect(second).toMatchObject({ weddingId: 'w2', availableCents: 500, pendingCents: 0 });
  });

  it('RN02 (B6-2) - o Disponível soma os ajustes sem repasse; o do repasse vai em "em repasse"', () => {
    expect(
      commissionBalances(rows, [
        {
          id: 'a',
          reason: 'manual',
          commissionId: null,
          createdAt: new Date(),
          amountCents: -1_000,
          payoutId: null,
          payoutStatus: null,
        },
        {
          id: 'a',
          reason: 'manual',
          commissionId: null,
          createdAt: new Date(),
          amountCents: -500,
          payoutId: 'p1',
          payoutStatus: 'requested',
        },
      ]),
    ).toMatchObject({ availableCents: 6_242, inPayoutCents: 2_500 });
  });

  it('RN02 (B6-2) - o ajuste de um repasse já pago soma no Já recebido e sai do "em repasse", como no Backoffice', () => {
    const base = commissionBalances(rows);
    expect(
      commissionBalances(rows, [
        {
          id: 'a',
          reason: 'manual',
          commissionId: null,
          createdAt: new Date(),
          amountCents: -1_000,
          payoutId: 'p0',
          payoutStatus: 'paid',
        },
        {
          id: 'a',
          reason: 'manual',
          commissionId: null,
          createdAt: new Date(),
          amountCents: -500,
          payoutId: 'p1',
          payoutStatus: 'processing',
        },
      ]),
    ).toEqual({
      ...base,
      receivedCents: base.receivedCents - 1_000,
      inPayoutCents: base.inPayoutCents - 500,
    });
  });

  it('RN07 e RN08 (decisão 346(1)) - por casamento: a origem, os pagamentos, o já recebido e o total, sem Estornada, Bloqueada e Retida', () => {
    const [first, second] = commissionsByWedding({ rows });
    expect(first).toMatchObject({
      referralSource: 'referral_link',
      paymentsCount: 5,
      receivedCents: 5_000,
      totalCents: 6_742 + 1_740 + 1_000 + 5_000 + 3_000,
    });
    expect(second).toMatchObject({ paymentsCount: 1, receivedCents: 0, totalCents: 500 });
    const [onlyReversed] = commissionsByWedding({ rows: [row({ status: 'reversed' })] });
    expect(onlyReversed).toMatchObject({ paymentsCount: 0, totalCents: 0 });
  });

  it('RN02 e RN07 (decisão 350(12)) - por casamento: os ajustes do casal entram como no topo; o manual fica só no topo', () => {
    const adjustment = { reason: 'refund', createdAt: new Date('2026-09-01T12:00:00Z') };
    const weddingRows = [
      row({ id: 'c1', status: 'paid', amountCents: 5_000, payoutId: 'p0' }),
      row({ id: 'c2', weddingId: 'w2', status: 'available', amountCents: 500 }),
    ];
    const [first, second] = commissionsByWedding({
      rows: weddingRows,
      adjustments: [
        // Sem repasse: no Disponível e no Total.
        {
          ...adjustment,
          id: 'x1',
          commissionId: 'c1',
          amountCents: -1_000,
          payoutId: null,
          payoutStatus: null,
        },
        // Num repasse aberto: só no Total (é o "em repasse" do topo).
        {
          ...adjustment,
          id: 'x2',
          commissionId: 'c1',
          amountCents: -300,
          payoutId: 'p1',
          payoutStatus: 'requested',
        },
        // Num repasse pago: no Já recebido e no Total.
        {
          ...adjustment,
          id: 'x3',
          commissionId: 'c1',
          amountCents: -2_000,
          payoutId: 'p2',
          payoutStatus: 'paid',
        },
        // O manual, sem casamento: em nenhum casal.
        {
          ...adjustment,
          id: 'x4',
          reason: 'manual',
          commissionId: null,
          amountCents: -7_000,
          payoutId: null,
          payoutStatus: null,
        },
      ],
    });
    expect(first).toMatchObject({
      weddingId: 'w1',
      paymentsCount: 1,
      availableCents: -1_000,
      receivedCents: 5_000 - 2_000,
      totalCents: 5_000 - 1_000 - 300 - 2_000,
    });
    expect(second).toMatchObject({
      weddingId: 'w2',
      availableCents: 500,
      receivedCents: 0,
      totalCents: 500,
    });
  });

  it('RN02 (decisão 346(2)) - o ajuste da legenda do Disponível: só os sem repasse', () => {
    const adjustment = { id: 'a', reason: 'manual', createdAt: new Date(), commissionId: null };
    expect(
      availableAdjustmentsCents([
        { ...adjustment, amountCents: -5_002, payoutId: null, payoutStatus: null },
        { ...adjustment, amountCents: -1_000, payoutId: 'p1', payoutStatus: 'paid' },
        { ...adjustment, amountCents: -500, payoutId: 'p2', payoutStatus: 'requested' },
      ]),
    ).toBe(-5_002);
    expect(availableAdjustmentsCents([])).toBe(0);
  });

  it('RN07 (decisão 347(2)) - o ajuste leva a comissão que ajustou; o manual, nenhuma', () => {
    const adjustment = {
      reason: 'refund',
      createdAt: new Date('2026-09-01T12:00:00Z'),
      amountCents: -6_742,
      payoutId: null,
      payoutStatus: null,
    };
    const lines = commissionPaymentLines({
      rows: [row({ id: 'c1' })],
      adjustments: [
        { ...adjustment, id: 'x1', commissionId: 'c1' },
        { ...adjustment, id: 'x2', reason: 'manual', commissionId: null },
      ],
    });
    const byId = new Map(
      lines.flatMap((line) =>
        line.kind === 'adjustment' ? [[line.adjustment.id, line.commission?.id ?? null]] : [],
      ),
    );
    expect(byId).toEqual(
      new Map([
        ['x1', 'c1'],
        ['x2', null],
      ]),
    );
  });
});
