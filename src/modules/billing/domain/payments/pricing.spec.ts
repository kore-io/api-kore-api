import { InstallmentsOutOfRangeError, monthsCovered, priceQuote } from './pricing';

const publication = (overrides: Partial<Parameters<typeof priceQuote>[0]> = {}) =>
  priceQuote({
    kind: 'publication',
    monthsCovered: 7,
    method: 'card',
    installments: 1,
    referralDiscountPercent: null,
    ...overrides,
  });

describe('priceQuote (Preço e cotação RN01; priceVersion 2026-11)', () => {
  it('RN01 - 7 meses no cartão em 2x, com a assessoria: R$ 337,10 em 2x de R$ 168,55', () => {
    const quote = publication({ installments: 2, referralDiscountPercent: 10 });
    expect(quote).toMatchObject({
      priceVersion: '2026-11',
      activationListCents: 14_900,
      monthlyListCents: 2_900,
      listTotalCents: 35_200,
      capDiscountCents: 0,
      referralDiscountCents: 1_490,
      pixDiscountCents: 0,
      installmentInterestCents: 0,
      totalCents: 33_710,
      installmentCents: 16_855,
      firstInstallmentCents: 16_855,
    });
  });

  it('RN01 (B1-1) - em 3x a primeira parcela leva a diferença: R$ 112,38 e 2 × R$ 112,36', () => {
    const quote = publication({ installments: 3, referralDiscountPercent: 10 });
    expect(quote).toMatchObject({ firstInstallmentCents: 11_238, installmentCents: 11_236 });
    expect(quote.firstInstallmentCents + 2 * quote.installmentCents).toBe(33_710);
  });

  it('RN01 - 7 meses no Pix, com a assessoria: desconto R$ 10,11 e total R$ 326,99', () => {
    expect(publication({ method: 'pix', referralDiscountPercent: 10 })).toMatchObject({
      pixDiscountCents: 1_011,
      totalCents: 32_699,
    });
  });

  it('RN01 - o teto corta em 12 meses: tabela R$ 497,00, preço máximo R$ 48,00, Pix R$ 421,08', () => {
    expect(
      publication({ monthsCovered: 12, method: 'pix', referralDiscountPercent: 10 }),
    ).toMatchObject({ listTotalCents: 49_700, capDiscountCents: 4_800, totalCents: 42_108 });
  });

  it('RN01 - juros de 7x a 12x: R$ 13,94 em 8x, total R$ 351,04 em 8x de R$ 43,88', () => {
    const quote = publication({ installments: 8, referralDiscountPercent: 10 });
    expect(quote).toMatchObject({
      installmentInterestCents: 1_394,
      totalCents: 35_104,
      installmentCents: 4_388,
    });
    expect(quote.totalsByMethod).toEqual({ pix: 32_699, cardUpTo6: 33_710, cardChosen: 35_104 });
  });

  it.each([
    [1, false, 'card', 17_800],
    [6, false, 'card', 32_300],
    [9, false, 'card', 41_000],
    [11, false, 'card', 44_900],
    [12, true, 'card', 43_410],
    [12, false, 'pix', 43_553],
    [7, false, 'pix', 34_144],
  ] as const)(
    'RN01 - tabela: %i meses, indicação %s, %s = %i',
    (months, referral, method, total) => {
      expect(
        publication({
          monthsCovered: months,
          method,
          referralDiscountPercent: referral ? 10 : null,
        }).totalCents,
      ).toBe(total);
    },
  );

  it('RN01 - extensão sem teto e com Pix: 3 meses = R$ 84,39, sem ativação nem indicação', () => {
    expect(
      priceQuote({
        kind: 'extension',
        monthsCovered: 3,
        method: 'pix',
        installments: 1,
        referralDiscountPercent: 10,
      }),
    ).toMatchObject({
      activationListCents: 0,
      referralDiscountCents: 0,
      capDiscountCents: 0,
      totalCents: 8_439,
    });
  });

  it('D5 - a extensão nunca tem teto acumulado: 12 meses a mais = R$ 348,00', () => {
    expect(
      priceQuote({
        kind: 'extension',
        monthsCovered: 12,
        method: 'card',
        installments: 1,
        referralDiscountPercent: null,
        paidHistory: [{ kind: 'publication', monthsCovered: 12, amountCents: 44_900 }],
      }).totalCents,
    ).toBe(34_800);
  });

  it('RN01 (B1-2) - parcela mínima: a extensão de 1 mês vai até 5x; 12x é recusado', () => {
    const extension = (installments: number) =>
      priceQuote({
        kind: 'extension',
        monthsCovered: 1,
        method: 'card',
        installments,
        referralDiscountPercent: null,
      });
    expect(extension(5).maxInstallments).toBe(5);
    expect(() => extension(12)).toThrow(InstallmentsOutOfRangeError);
    try {
      extension(12);
    } catch (error) {
      expect((error as InstallmentsOutOfRangeError).maxInstallments).toBe(5);
    }
  });

  it('RN01 - Pix é à vista: parcelas diferentes de 1 são recusadas', () => {
    expect(() => publication({ method: 'pix', installments: 2 })).toThrow(
      InstallmentsOutOfRangeError,
    );
  });

  it('B1-3 - teste de propriedade: total = soma das linhas e soma das parcelas = total', () => {
    for (let months = 1; months <= 12; months++) {
      for (const kind of ['publication', 'extension'] as const) {
        for (const referral of [null, 10, 0, 15]) {
          for (const method of ['pix', 'card'] as const) {
            const max = priceQuote({
              kind,
              monthsCovered: months,
              method: 'card',
              installments: 1,
              referralDiscountPercent: referral,
            }).maxInstallments;
            for (
              let installments = 1;
              installments <= (method === 'pix' ? 1 : max);
              installments++
            ) {
              const quote = priceQuote({
                kind,
                monthsCovered: months,
                method,
                installments,
                referralDiscountPercent: referral,
              });
              const lines =
                quote.activationListCents +
                quote.monthlyListCents * quote.monthsCovered -
                quote.capDiscountCents -
                quote.referralDiscountCents -
                quote.pixDiscountCents +
                quote.installmentInterestCents;
              expect(quote.totalCents).toBe(lines);
              expect(
                quote.firstInstallmentCents + quote.installmentCents * (quote.installments - 1),
              ).toBe(quote.totalCents);
              expect(Number.isInteger(quote.totalCents)).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('monthsCovered (Preço e cotação RN02)', () => {
  it.each([
    ['2026-08-10', '2027-02-14', 7],
    ['2027-01-31', '2027-02-28', 1],
    ['2027-01-31', '2027-03-01', 2],
    ['2027-02-14', '2027-05-14', 3],
    ['2028-02-29', '2029-02-28', 12],
    ['2027-11-30', '2028-02-28', 3],
    ['2026-08-09', '2026-09-09', 1],
  ])('RN02 - de %s até %s: %i meses', (start, endDate, months) => {
    expect(monthsCovered({ start, endDate })).toBe(months);
  });

  it('RN02 - a data de saída do ar precisa ser depois do início', () => {
    expect(() => monthsCovered({ start: '2026-08-10', endDate: '2026-08-10' })).toThrow();
  });
});
