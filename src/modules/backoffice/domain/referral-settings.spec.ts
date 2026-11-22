import { referralSettingsChanges, referralSettingsErrors } from './referral-settings';

const current = {
  defaultRatePercent: 20,
  referralDiscountPercent: 10,
  commissionHoldDays: 30,
  payoutMinCents: 5_000,
};

describe('Indicação nas Configurações (Backoffice - cobrança RN10; decisão 78)', () => {
  it('RN10 - "120" na comissão padrão fica fora do formato (de 0 a 100)', () => {
    expect(referralSettingsErrors({ ...current, defaultRatePercent: 120 })).toEqual([
      { path: 'defaultRatePercent', code: 'MAX', params: { max: 100 } },
    ]);
  });

  it('RN10 - os limites de cada campo: percentuais de 0 a 100, prazo de 0 a 90 dias, mínimo a partir de R$ 1', () => {
    expect(
      referralSettingsErrors({
        defaultRatePercent: -1,
        referralDiscountPercent: 101,
        commissionHoldDays: 91,
        payoutMinCents: 99,
      }),
    ).toEqual([
      { path: 'defaultRatePercent', code: 'MIN', params: { min: 0 } },
      { path: 'referralDiscountPercent', code: 'MAX', params: { max: 100 } },
      { path: 'commissionHoldDays', code: 'MAX', params: { max: 90 } },
      { path: 'payoutMinCents', code: 'MIN', params: { min: 100 } },
    ]);
  });

  it('RN10 - o repasse mínimo tem o teto técnico da coluna (int4): acima dele, 422 MAX em vez de 500', () => {
    expect(referralSettingsErrors({ ...current, payoutMinCents: 2_147_483_647 })).toEqual([]);
    for (const payoutMinCents of [2_147_483_648, 1e20])
      expect(referralSettingsErrors({ ...current, payoutMinCents })).toEqual([
        { path: 'payoutMinCents', code: 'MAX', params: { max: 2_147_483_647 } },
      ]);
  });

  it('RN10 (B6-1) - comissão padrão de 0%, prazo de 0 dias e mínimo de R$ 1 são aceitos', () => {
    expect(
      referralSettingsErrors({
        defaultRatePercent: 0,
        referralDiscountPercent: 100,
        commissionHoldDays: 0,
        payoutMinCents: 100,
      }),
    ).toEqual([]);
  });

  it('RN10 - o log leva só o que mudou, com o antes e o depois ("Comissão padrão: 20% → 22%")', () => {
    expect(
      referralSettingsChanges({ before: current, after: { ...current, defaultRatePercent: 22 } }),
    ).toEqual({ defaultRatePercent: { from: 20, to: 22 } });
    expect(referralSettingsChanges({ before: current, after: { ...current } })).toEqual({});
  });
});
