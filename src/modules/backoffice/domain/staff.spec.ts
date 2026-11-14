import { isStaffSession } from './staff';

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
