import { csvCell, paymentsCsv } from './payments-csv';

describe('CSV da Cobrança (Backoffice - cobrança RN07; B10-6)', () => {
  it('RN07 (B10-6) - a célula que começa com =, +, - ou @ é neutralizada', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+55')).toBe("'+55");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('Ana & Marcos')).toBe('Ana & Marcos');
  });

  it('RN07 - uma linha por pagamento e por estorno, com juros, taxa e líquido em reais', () => {
    const csv = paymentsCsv([
      {
        line: 'pagamento',
        code: 'P-0431',
        coupleNames: 'Ana & Marcos',
        kind: 'publication',
        method: 'card',
        installments: 10,
        amountWithoutInterestCents: 33710,
        interestCents: 1462,
        gatewayFeeCents: 1100,
        netCents: 34072,
        paidAt: new Date('2026-09-10T12:00:00Z'),
        refundedAt: null,
        status: 'paid',
        applied: true,
        gatewayPaymentId: 'pay_1',
      },
    ]);
    const [header, line] = csv.trim().split('\r\n');
    expect(header.split(',')).toContain('valor_sem_juros');
    expect(line).toBe(
      'pagamento,P-0431,Ana & Marcos,publication,card,10,337.10,14.62,11.00,340.72,2026-09-10T12:00:00.000Z,,paid,sim,pay_1',
    );
  });
});
