import { loginNextStep, storableOriginRef } from './login-next-step';

describe('RN06 - para onde a pessoa vai depois de confirmar o e-mail', () => {
  it('dado que veio de um convite de acesso, quando confirma, então volta ao convite', () => {
    expect(loginNextStep({ origin: 'invite', profileCount: 0 })).toBe('invite');
  });

  it.each(['referral', 'couple_signup'] as const)(
    'dado que veio por %s, quando confirma, então segue para o cadastro do casal',
    (origin) => {
      expect(loginNextStep({ origin, profileCount: 0 })).toBe('couple_signup');
    },
  );

  it('dado que veio por "Para cerimonialistas", quando confirma, então segue para o cadastro do cerimonialista', () => {
    expect(loginNextStep({ origin: 'planner_signup', profileCount: 0 })).toBe('planner_signup');
  });

  it.each([
    [0, 'choose_profile'],
    [1, 'home'],
    [2, 'choose_profile'],
  ])(
    'dado que veio pela tela Entrar com %i perfis, quando confirma, então vai para %s (RN14)',
    (profileCount, next) => {
      expect(loginNextStep({ origin: 'none', profileCount })).toBe(next);
    },
  );
});

describe('RN03 de Convites - o token do convite não vai ao banco (decisão 142)', () => {
  it('dado que veio de um convite, quando guarda a origem, então descarta o token', () => {
    expect(storableOriginRef({ origin: 'invite', originRef: 'token-do-convite' })).toBeNull();
  });

  it('dado que veio pelo link de indicação, quando guarda a origem, então mantém o código', () => {
    expect(storableOriginRef({ origin: 'referral', originRef: 'juliana-prado' })).toBe(
      'juliana-prado',
    );
  });
});
