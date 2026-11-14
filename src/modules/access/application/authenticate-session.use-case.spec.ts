import { SessionExpiredError } from '../domain/access.errors';
import { AuthenticateSession } from './authenticate-session.use-case';
import type { SessionRecord, SessionRepository } from './ports/session-repository.port';
import type { SessionTokens } from './ports/session-token.port';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-05T12:00:00.000Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

function buildRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date(now.getTime() + DAY_MS),
    lastSeenAt: ago(6 * DAY_MS),
    authenticatedAt: ago(6 * DAY_MS),
    authMethod: 'email',
    activeProfile: null,
    staffDomain: null,
    supportSessionId: null,
    revokedAt: null,
    userStatus: 'active',
    ...overrides,
  };
}

function buildUseCase({ record }: { record: SessionRecord | null }) {
  const renew = jest.fn().mockResolvedValue(undefined);
  const revoke = jest.fn().mockResolvedValue(undefined);
  const sessions: SessionRepository = {
    create: jest.fn(),
    findByTokenHash: jest.fn().mockResolvedValue(record),
    renew,
    revoke,
    revokeAllForUser: jest.fn(),
    setActiveProfile: jest.fn(),
  };
  const tokens: SessionTokens = { generate: jest.fn(), hash: ({ token }) => `hash:${token}` };
  return { useCase: new AuthenticateSession(sessions, tokens), renew, revoke };
}

describe('AuthenticateSession', () => {
  describe('RN08 - a sessão se renova com o uso', () => {
    it('dado que entrei há 6 dias e usei hoje, quando uso de novo, então a sessão vai a 7 dias a partir de agora', async () => {
      const { useCase, renew } = buildUseCase({ record: buildRecord() });

      const { renewedUntil, session } = await useCase.execute({ token: 't', now });

      const expected = new Date(now.getTime() + 7 * DAY_MS);
      expect(renewedUntil).toEqual(expected);
      expect(renew).toHaveBeenCalledWith({ sessionId: 'session-1', now, expiresAt: expected });
      expect(session).toEqual({
        sessionId: 'session-1',
        userId: 'user-1',
        authenticatedAt: ago(6 * DAY_MS),
        authMethod: 'email',
        activeProfile: null,
        staffDomain: null,
      });
    });

    it('dado um uso há segundos, quando uso de novo, então não grava outra renovação', async () => {
      const { useCase, renew } = buildUseCase({ record: buildRecord({ lastSeenAt: ago(10_000) }) });

      const { renewedUntil } = await useCase.execute({ token: 't', now });

      expect(renewedUntil).toBeNull();
      expect(renew).not.toHaveBeenCalled();
    });

    it('dado que usei pela última vez há 8 dias, quando abro o app, então a sessão terminou', async () => {
      const record = buildRecord({ lastSeenAt: ago(8 * DAY_MS), expiresAt: ago(DAY_MS) });

      await expect(buildUseCase({ record }).useCase.execute({ token: 't', now })).rejects.toThrow(
        SessionExpiredError,
      );
    });
  });

  describe('RN13 - o uso não renova o login recente', () => {
    it('dado que entrei há 3 dias e usei todos os dias, quando uso, então authenticatedAt continua o do login', async () => {
      const record = buildRecord({ authenticatedAt: ago(3 * DAY_MS), lastSeenAt: ago(DAY_MS) });

      const { session } = await buildUseCase({ record }).useCase.execute({ token: 't', now });

      expect(session.authenticatedAt).toEqual(ago(3 * DAY_MS));
    });
  });

  describe('RN09 e RN10 - sessão encerrada ou ausente', () => {
    it.each([
      ['sem cookie', undefined, buildRecord()],
      ['com token desconhecido', 't', null],
      ['com a sessão encerrada', 't', buildRecord({ revokedAt: ago(1000) })],
    ])(
      'dada uma requisição %s, quando autentica, então a sessão terminou',
      async (_, token, record) => {
        await expect(buildUseCase({ record }).useCase.execute({ token, now })).rejects.toThrow(
          SessionExpiredError,
        );
      },
    );
  });

  describe('RN11 - usuário bloqueado não entra', () => {
    it('dado um usuário bloqueado com sessão aberta, quando usa o app, então a sessão é encerrada', async () => {
      const { useCase, revoke } = buildUseCase({ record: buildRecord({ userStatus: 'blocked' }) });

      await expect(useCase.execute({ token: 't', now })).rejects.toThrow(SessionExpiredError);
      expect(revoke).toHaveBeenCalledWith({ sessionId: 'session-1', now });
    });
  });
});
