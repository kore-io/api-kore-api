import { loginNextStep } from './login-next-step';

describe('RN06 - para onde a pessoa vai depois de confirmar o e-mail', () => {
  it('dado que veio de um convite de acesso, quando confirma, então volta ao convite', () => {
    expect(loginNextStep({ origin: 'invite', originRef: 'tok', profileCount: 0 })).toEqual({
      next: 'invite',
      inviteToken: 'tok',
    });
  });

  it.each(['referral', 'couple_signup'] as const)(
    'dado que veio por %s, quando confirma, então segue para o cadastro do casal',
    (origin) => {
      expect(loginNextStep({ origin, originRef: null, profileCount: 0 })).toEqual({
        next: 'couple_signup',
      });
    },
  );

  it('dado que veio por "Para cerimonialistas", quando confirma, então segue para o cadastro do cerimonialista', () => {
    expect(loginNextStep({ origin: 'planner_signup', originRef: null, profileCount: 0 })).toEqual({
      next: 'planner_signup',
    });
  });

  it.each([
    [0, 'choose_profile'],
    [1, 'home'],
    [2, 'choose_profile'],
  ])(
    'dado que veio pela tela Entrar com %i perfis, quando confirma, então vai para %s (RN14)',
    (profileCount, next) => {
      expect(loginNextStep({ origin: 'none', originRef: null, profileCount })).toEqual({ next });
    },
  );
});
