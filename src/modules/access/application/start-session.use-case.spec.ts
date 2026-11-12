import type { SessionRepository } from './ports/session-repository.port';
import type { SessionTokens } from './ports/session-token.port';
import { StartSession } from './start-session.use-case';

describe('StartSession', () => {
  it('RN08 - dado um login, quando abre a sessão, então guarda só o hash do token e vale 7 dias', async () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    const create = jest.fn().mockResolvedValue({ id: 'session-1' });
    const sessions = { create } as unknown as SessionRepository;
    const tokens: SessionTokens = {
      generate: () => ({ token: 'aberto', tokenHash: 'hash' }),
      hash: jest.fn(),
    };

    const result = await new StartSession(sessions, tokens).execute({
      userId: 'user-1',
      now,
      authMethod: 'email',
      userAgent: 'Mozilla/5.0',
    });

    const expiresAt = new Date('2026-11-12T12:00:00.000Z');
    expect(result).toEqual({ token: 'aberto', expiresAt });
    expect(create).toHaveBeenCalledWith({
      userId: 'user-1',
      tokenHash: 'hash',
      now,
      expiresAt,
      authMethod: 'email',
      userAgent: 'Mozilla/5.0',
    });
  });
});
