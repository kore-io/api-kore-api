import { supportSessionExpiresAt, supportSessionExpiry } from './support-session';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 14, 12, minutes));
const session = (startedAt: number, lastSeenAt: number) => ({
  id: 's',
  adminUserId: 'a',
  weddingId: 'w',
  startedAt: at(startedAt),
  lastSeenAt: at(lastSeenAt),
  endedAt: null,
});

describe('Ver como o casal (Backoffice - acesso RN08)', () => {
  it('RN08 - termina com 30 minutos sem requisição', () => {
    expect(supportSessionExpiry({ session: session(0, 0), now: at(29) })).toBeNull();
    expect(supportSessionExpiry({ session: session(0, 0), now: at(30) })).toBe('idle');
  });

  it('RN08 - termina no teto de 2 horas, mesmo em uso', () => {
    expect(supportSessionExpiry({ session: session(0, 110), now: at(119) })).toBeNull();
    expect(supportSessionExpiry({ session: session(0, 119), now: at(120) })).toBe('max_duration');
  });

  it('RN08 - vale até o menor entre a ociosidade e o teto', () => {
    expect(supportSessionExpiresAt({ session: session(0, 10) })).toEqual(at(40));
    expect(supportSessionExpiresAt({ session: session(0, 100) })).toEqual(at(120));
  });
});
