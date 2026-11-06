import type { AuthenticatedSession } from '../domain/authenticated-session';
import { GetMe } from './get-me.use-case';
import type { ProfileDirectory } from './ports/profile-directory.port';
import type { UserRepository } from './ports/user-repository.port';

const session: AuthenticatedSession = {
  sessionId: 's1',
  userId: 'u1',
  authenticatedAt: new Date('2026-11-10T00:00:00Z'),
  authMethod: 'email',
  activeProfile: null,
};

function getMe() {
  const users = {
    findProfileById: jest
      .fn()
      .mockResolvedValue({ id: 'u1', name: 'Ana', email: 'a@x.com', platformRole: 'none' }),
  } satisfies UserRepository;
  const profiles = {
    listProfiles: jest.fn(),
    overview: jest
      .fn()
      .mockResolvedValue({ memberships: [], profiles: ['couple'], planner: null, referrer: null }),
  } satisfies ProfileDirectory;
  return new GetMe(users, profiles);
}

describe('GetMe (GET /v1/me)', () => {
  it('RN14 - o último perfil do aparelho só vale se ainda for da conta', async () => {
    expect(
      (await getMe().execute({ session, lastProfileOnDevice: 'couple' })).lastProfileOnDevice,
    ).toBe('couple');
    expect(
      (await getMe().execute({ session, lastProfileOnDevice: 'planner' })).lastProfileOnDevice,
    ).toBeNull();
  });
});
