import { toReferral, type ReferrerRecord } from './referral';

const juliana: ReferrerRecord = {
  referrerId: 'r1',
  userId: 'u-juliana',
  referralCode: 'juliana-prado',
  kind: 'planner',
  status: 'active',
  accountStatus: 'active',
  displayName: 'Juliana Prado',
  referralDiscountEnabled: true,
};

describe('toReferral (RN08 e RN09 de Cadastro)', () => {
  it('RN08 - dado o indicador ativo, então o cadastro mostra a indicação com o nome', () => {
    expect(toReferral({ referrer: juliana, referralDiscountPercent: 10 })).toEqual({
      code: 'juliana-prado',
      referrerName: 'Juliana Prado',
      kind: 'planner',
      discountPercent: 10,
    });
  });

  it.each(['inactive', 'blocked'] as const)(
    'RN08 - dado o indicador %s, então não há indicação',
    (status) => {
      expect(toReferral({ referrer: { ...juliana, status }, referralDiscountPercent: 10 })).toBe(
        null,
      );
    },
  );

  it('RN08 - dada a conta do indicador bloqueada (decisão 162), então não há indicação', () => {
    expect(
      toReferral({
        referrer: { ...juliana, accountStatus: 'blocked' },
        referralDiscountPercent: 10,
      }),
    ).toBe(null);
  });

  it('RN08 - dado o indicador sem nome, então não há o que destacar', () => {
    expect(
      toReferral({ referrer: { ...juliana, displayName: null }, referralDiscountPercent: 10 }),
    ).toBe(null);
  });

  it('RN09 - dado o desconto de indicação desligado, então discountPercent é nulo', () => {
    expect(
      toReferral({
        referrer: { ...juliana, referralDiscountEnabled: false },
        referralDiscountPercent: 10,
      })?.discountPercent,
    ).toBe(null);
  });
});
