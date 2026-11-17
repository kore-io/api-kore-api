import { parsePlatformRoleArgs, PlatformRoleUsageError } from './change-platform-role';

describe('parsePlatformRoleArgs (Backoffice - acesso RN01)', () => {
  it('RN01 - lê o e-mail, o papel, quem roda e o motivo', () => {
    expect(
      parsePlatformRoleArgs({
        argv: ['--email', 'a@kore.com.br', '--role', 'admin', '--by', 'ops', '--reason', 'Entrada'],
      }),
    ).toEqual({ email: 'a@kore.com.br', role: 'admin', by: 'ops', reason: 'Entrada' });
  });

  it('RN01 - sem um dos quatro, ou com o valor faltando, mostra o uso', () => {
    expect(() =>
      parsePlatformRoleArgs({
        argv: ['--email', 'a@kore.com.br', '--role', 'admin', '--by', 'ops'],
      }),
    ).toThrow(PlatformRoleUsageError);
    expect(() =>
      parsePlatformRoleArgs({
        argv: ['--email', '--role', 'admin', '--by', 'ops', '--reason', 'x'],
      }),
    ).toThrow(PlatformRoleUsageError);
  });
});
