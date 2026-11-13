import { newCommission, type CommissionInput } from './commission';

const base: CommissionInput = {
  amountCents: 33_710,
  installmentInterestCents: 0,
  ratePercent: 20,
  referrerStatus: 'active',
  referrerTaxIdHash: null,
  payerTaxIdHash: 'taxid:v1:pagador',
};

describe('A comissão do indicador (Comissões RN01, RN03 e RN04)', () => {
  it('RN01 - os exemplos da spec: R$ 337,10 → R$ 67,42; R$ 326,99 no Pix → R$ 65,40; extensão de R$ 87,00 → R$ 17,40', () => {
    expect(newCommission(base)).toEqual({
      kind: 'create',
      baseAmountCents: 33_710,
      amountCents: 6_742,
      status: 'pending',
      blockReason: null,
    });
    expect(newCommission({ ...base, amountCents: 32_699 })).toMatchObject({ amountCents: 6_540 });
    expect(newCommission({ ...base, amountCents: 8_700 })).toMatchObject({ amountCents: 1_740 });
  });

  it('RN01 - a base não leva os juros do cartão', () => {
    expect(
      newCommission({ ...base, amountCents: 35_104, installmentInterestCents: 1_394 }),
    ).toMatchObject({ baseAmountCents: 33_710, amountCents: 6_742 });
  });

  it('RN01 (B6-1) - meio para cima ao centavo; resultado zero não nasce', () => {
    // 2,5 centavos → 3.
    expect(newCommission({ ...base, amountCents: 50, ratePercent: 5 })).toMatchObject({
      amountCents: 3,
    });
    expect(newCommission({ ...base, ratePercent: 0 })).toEqual({ kind: 'none' });
  });

  it('RN03 - autoindicação pelo mesmo HMAC: nasce bloqueada', () => {
    expect(newCommission({ ...base, referrerTaxIdHash: 'taxid:v1:pagador' })).toMatchObject({
      status: 'blocked',
      blockReason: 'self_referral',
    });
  });

  it('RN04 - indicador bloqueado ou inativo: nasce bloqueada', () => {
    for (const referrerStatus of ['blocked', 'inactive'] as const)
      expect(newCommission({ ...base, referrerStatus })).toMatchObject({
        status: 'blocked',
        blockReason: 'referrer_blocked',
      });
  });
});
