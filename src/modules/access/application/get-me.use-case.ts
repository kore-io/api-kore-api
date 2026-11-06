import { Inject, Injectable } from '@nestjs/common';
import { SessionExpiredError } from '../domain/access.errors';
import type { AuthenticatedSession, ProfileKind } from '../domain/authenticated-session';
import {
  PROFILE_DIRECTORY,
  type AccountOverview,
  type ProfileDirectory,
} from './ports/profile-directory.port';
import {
  USER_REPOSITORY,
  type UserProfile,
  type UserRepository,
} from './ports/user-repository.port';

export interface Me extends AccountOverview {
  user: UserProfile;
  activeProfile: ProfileKind | null;
  /** O último perfil escolhido neste aparelho, se ainda for da conta (RN14). */
  lastProfileOnDevice: ProfileKind | null;
  authenticatedAt: Date;
}

/** Quem está conectado, os perfis e os vínculos (GET /v1/me; RN08, RN14). */
@Injectable()
export class GetMe {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PROFILE_DIRECTORY) private readonly profiles: ProfileDirectory,
  ) {}

  async execute({
    session,
    lastProfileOnDevice,
  }: {
    session: AuthenticatedSession;
    lastProfileOnDevice: ProfileKind | null;
  }): Promise<Me> {
    const user = await this.users.findProfileById({ userId: session.userId });
    // Usuário apagado depois do login: a sessão já não vale.
    if (!user) throw new SessionExpiredError();
    const overview = await this.profiles.overview({ userId: session.userId });
    return {
      user,
      ...overview,
      // Perfil que a conta já não tem (ex.: dono que saiu, noutro aparelho) vale
      // como nenhum; a sessão no banco não muda (decisão 179).
      activeProfile:
        session.activeProfile && overview.profiles.includes(session.activeProfile)
          ? session.activeProfile
          : null,
      lastProfileOnDevice:
        lastProfileOnDevice && overview.profiles.includes(lastProfileOnDevice)
          ? lastProfileOnDevice
          : null,
      authenticatedAt: session.authenticatedAt,
    };
  }
}
