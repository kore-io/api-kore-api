import { isSessionActive, renewedExpiry, shouldRenew } from './session-lifetime';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-05T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);
const daysAhead = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe('RN08 - a sessão dura 7 dias a partir do último uso', () => {
  it('dado um uso agora, quando renova, então a sessão vai até 7 dias depois', () => {
    expect(renewedExpiry({ now })).toEqual(daysAhead(7));
  });

  it('dada uma sessão dentro do prazo e não encerrada, quando confere, então está ativa', () => {
    expect(
      isSessionActive({
        session: { expiresAt: daysAhead(1), lastSeenAt: daysAgo(6), revokedAt: null },
        now,
      }),
    ).toBe(true);
  });

  it('dada uma sessão vencida, quando confere, então não está ativa', () => {
    expect(
      isSessionActive({
        session: { expiresAt: daysAgo(1), lastSeenAt: daysAgo(8), revokedAt: null },
        now,
      }),
    ).toBe(false);
  });

  it('dada uma sessão encerrada (RN09), quando confere, então não está ativa', () => {
    expect(
      isSessionActive({
        session: { expiresAt: daysAhead(7), lastSeenAt: now, revokedAt: daysAgo(0) },
        now,
      }),
    ).toBe(false);
  });

  it('dado um uso há menos de um minuto, quando confere, então não grava outra renovação', () => {
    const session = {
      expiresAt: daysAhead(7),
      lastSeenAt: new Date(now.getTime() - 30_000),
      revokedAt: null,
    };
    expect(shouldRenew({ session, now })).toBe(false);
  });

  it('dado um uso há um minuto ou mais, quando confere, então renova', () => {
    const session = {
      expiresAt: daysAhead(7),
      lastSeenAt: new Date(now.getTime() - 60_000),
      revokedAt: null,
    };
    expect(shouldRenew({ session, now })).toBe(true);
  });
});
