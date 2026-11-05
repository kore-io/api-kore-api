import { Inject, Injectable } from '@nestjs/common';
import { SessionExpiredError } from '../domain/access.errors';
import type { AuthenticatedSession, ProfileKind } from '../domain/authenticated-session';
import {
  USER_REPOSITORY,
  type UserProfile,
  type UserRepository,
} from './ports/user-repository.port';

export interface Me {
  user: UserProfile;
  activeProfile: ProfileKind | null;
  authenticatedAt: Date;
}

/**
 * Quem está conectado (GET /v1/me). Vínculos e perfis entram com os módulos
 * de casamento e de papéis (branch 59-papeis-perfis).
 */
@Injectable()
export class GetMe {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute({ session }: { session: AuthenticatedSession }): Promise<Me> {
    const user = await this.users.findProfileById({ userId: session.userId });
    // Usuário apagado depois do login: a sessão já não vale.
    if (!user) throw new SessionExpiredError();
    return { user, activeProfile: session.activeProfile, authenticatedAt: session.authenticatedAt };
  }
}
