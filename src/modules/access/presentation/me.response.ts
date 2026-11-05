import type { Me } from '../application/get-me.use-case';
import type { PlatformRole, ProfileKind } from '../domain/authenticated-session';

class MeUserResponse {
  id: string;
  name: string | null;
  email: string;
  platformRole: PlatformRole;
}

/** GET /v1/me. Vínculos e perfis entram na branch 59-papeis-perfis. */
export class MeResponse {
  user: MeUserResponse;
  activeProfile: ProfileKind | null;
  authenticatedAt: string;

  static from({ me }: { me: Me }): MeResponse {
    return {
      user: me.user,
      activeProfile: me.activeProfile,
      authenticatedAt: me.authenticatedAt.toISOString(),
    };
  }
}
