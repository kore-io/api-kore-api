import { ProfileNotOwnedError } from '../domain/access.errors';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import type { ProfileDirectory } from './ports/profile-directory.port';
import type { SessionRepository } from './ports/session-repository.port';
import { SetActiveProfile } from './set-active-profile.use-case';

const session: AuthenticatedSession = {
  sessionId: 's1',
  userId: 'u1',
  authenticatedAt: new Date(),
  authMethod: 'email',
  activeProfile: null,
};

function setup() {
  const profiles = {
    listProfiles: jest.fn().mockResolvedValue(['couple']),
    overview: jest.fn(),
  } satisfies ProfileDirectory;
  const sessions = {
    setActiveProfile: jest.fn().mockResolvedValue(undefined),
  } as unknown as SessionRepository;
  return { useCase: new SetActiveProfile(profiles, sessions), sessions };
}

describe('SetActiveProfile (POST /v1/me/active-profile)', () => {
  it('RN16 - escolhe um perfil da conta e devolve o home', async () => {
    const { useCase, sessions } = setup();

    await expect(useCase.execute({ session, profile: 'couple' })).resolves.toEqual({
      activeProfile: 'couple',
      home: '/app',
    });
    expect(sessions.setActiveProfile).toHaveBeenCalledWith({
      sessionId: 's1',
      userId: 'u1',
      profile: 'couple',
    });
  });

  it('RN14 - perfil que a conta não tem: PROFILE_NOT_OWNED, sem mexer na sessão', async () => {
    const { useCase, sessions } = setup();

    await expect(useCase.execute({ session, profile: 'planner' })).rejects.toThrow(
      ProfileNotOwnedError,
    );
    expect(sessions.setActiveProfile).not.toHaveBeenCalled();
  });
});
