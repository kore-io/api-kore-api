import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../shared/config/app-config.service';
import { SessionExpiredError } from '../domain/access.errors';
import type {
  AuthenticatedSession,
  AuthMethod,
  ProfileKind,
} from '../domain/authenticated-session';
import {
  PROFILE_DIRECTORY,
  type AccountOverview,
  type ProfileDirectory,
} from './ports/profile-directory.port';
import { IDENTITY_DIRECTORY, type IdentityDirectory } from './ports/identity-directory.port';
import {
  SUPPORT_SESSION_STORE,
  type SupportSessionStore,
} from './ports/support-session.store.port';
import { supportSessionExpiresAt } from '../domain/support-session';
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
  /** O cadastro próprio de cerimonialista está aberto (Cadastro e perfil RN02). */
  plannerSignupEnabled: boolean;
  /** As formas de entrar (Configurações › Acesso; decisão 254). */
  identities: { provider: AuthMethod }[];
  /** O Ver como o casal aberto nesta sessão do staff, para a faixa (Backoffice - acesso RN08). */
  supportSession: {
    weddingId: string;
    coupleNames: string;
    startedAt: Date;
    expiresAt: Date;
  } | null;
}

/** Quem está conectado, os perfis e os vínculos (GET /v1/me; RN08, RN14). */
@Injectable()
export class GetMe {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PROFILE_DIRECTORY) private readonly profiles: ProfileDirectory,
    private readonly config: AppConfigService,
    @Inject(IDENTITY_DIRECTORY) private readonly identities: IdentityDirectory,
    @Inject(SUPPORT_SESSION_STORE) private readonly support: SupportSessionStore,
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
    const providers = await this.identities.providers({ userId: session.userId });
    const support = session.supportSessionId
      ? await this.support.find({ id: session.supportSessionId })
      : null;
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
      plannerSignupEnabled: this.config.get({ key: 'PLANNER_SIGNUP_ENABLED' }),
      identities: providers.map((provider) => ({ provider })),
      supportSession:
        support && !support.endedAt
          ? {
              weddingId: support.weddingId,
              coupleNames: await this.support.coupleNames({ weddingId: support.weddingId }),
              startedAt: support.startedAt,
              expiresAt: supportSessionExpiresAt({ session: support }),
            }
          : null,
    };
  }
}
