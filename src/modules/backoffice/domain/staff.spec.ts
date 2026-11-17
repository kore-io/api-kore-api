import { hiddenLogActionPrefixes, isStaffSession, withoutMoney } from './staff';

describe('isStaffSession (Backoffice - acesso RN01)', () => {
  const expectedDomain = 'kore.com.br';

  it('RN01 - só o login pelo Google com o hd verificado do domínio da empresa', () => {
    expect(
      isStaffSession({ authMethod: 'google', staffDomain: 'kore.com.br', expectedDomain }),
    ).toBe(true);
    expect(
      isStaffSession({ authMethod: 'email', staffDomain: 'kore.com.br', expectedDomain }),
    ).toBe(false);
    expect(isStaffSession({ authMethod: 'google', staffDomain: null, expectedDomain })).toBe(false);
    expect(isStaffSession({ authMethod: 'google', staffDomain: 'kore.com', expectedDomain })).toBe(
      false,
    );
    expect(
      isStaffSession({ authMethod: 'google', staffDomain: 'evil.kore.com.br', expectedDomain }),
    ).toBe(false);
  });
});

describe('withoutMoney e hiddenLogActionPrefixes (Backoffice - acesso RN02; decisões 69 e 275)', () => {
  it('RN02 - o suporte não recebe centavos em nenhum nível do JSON, nem em listas', () => {
    const data = {
      amountCentsBefore: 1,
      reason: 'x',
      before: { payoutMinCents: 5000, ratePercent: 20 },
      items: [{ valueCents: 2, id: 'a' }, 3],
    };
    expect(withoutMoney({ data, role: 'support' })).toEqual({
      reason: 'x',
      before: { ratePercent: 20 },
      items: [{ id: 'a' }, 3],
    });
    expect(withoutMoney({ data, role: 'admin' })).toBe(data);
    expect(withoutMoney({ data: null, role: 'support' })).toBeNull();
  });

  it('RN02 - o suporte não lê as ações de Cobrança, Repasses, chave Pix e Configurações; o Admin lê todas', () => {
    expect(hiddenLogActionPrefixes({ role: 'admin' })).toEqual([]);
    expect(hiddenLogActionPrefixes({ role: 'support' })).toEqual([
      'payment.',
      'payments.',
      'payout.',
      'pix_key.',
      'settings.',
      'integration.',
    ]);
  });
});
