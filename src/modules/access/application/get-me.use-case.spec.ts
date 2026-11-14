import type { AppConfigService } from '../../../shared/config/app-config.service';
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
  staffDomain: null,
};

function getMe({ plannerSignupEnabled = false }: { plannerSignupEnabled?: boolean } = {}) {
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
  const config = { get: () => plannerSignupEnabled } as unknown as AppConfigService;
  const identities = { providers: jest.fn().mockResolvedValue(['email', 'google']) };
  return new GetMe(users, profiles, config, identities);
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

  it('decisão 179 - perfil ativo que a conta já não tem vale como nenhum', async () => {
    const me = await getMe().execute({
      session: { ...session, activeProfile: 'planner' },
      lastProfileOnDevice: null,
    });

    expect(me.activeProfile).toBeNull();
    expect(
      (
        await getMe().execute({
          session: { ...session, activeProfile: 'couple' },
          lastProfileOnDevice: null,
        })
      ).activeProfile,
    ).toBe('couple');
  });

  it('Cadastro e perfil RN02 - plannerSignupEnabled diz se o cadastro de cerimonialista está aberto', async () => {
    expect(
      (await getMe().execute({ session, lastProfileOnDevice: null })).plannerSignupEnabled,
    ).toBe(false);
    expect(
      (await getMe({ plannerSignupEnabled: true }).execute({ session, lastProfileOnDevice: null }))
        .plannerSignupEnabled,
    ).toBe(true);
  });

  it('decisão 254 - as formas de entrar vêm só com o provedor', async () => {
    expect((await getMe().execute({ session, lastProfileOnDevice: null })).identities).toEqual([
      { provider: 'email' },
      { provider: 'google' },
    ]);
  });
});
