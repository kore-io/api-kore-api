import { ReauthRequiredError, requireRecentSession } from './recent-session';

describe('Sessão recente (Retenção e expurgo RN08; Repasse RN03)', () => {
  const now = new Date('2026-09-26T14:00:00Z');
  const at = (minutesAgo: number) => ({
    authenticatedAt: new Date(now.getTime() - minutesAgo * 60_000),
  });

  it('RN08 - até 10 minutos passa; depois, REAUTH_REQUIRED', () => {
    expect(() => requireRecentSession({ session: at(5), now })).not.toThrow();
    expect(() => requireRecentSession({ session: at(10), now })).not.toThrow();
    expect(() => requireRecentSession({ session: at(11), now })).toThrow(ReauthRequiredError);
  });
});
