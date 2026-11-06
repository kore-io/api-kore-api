import { Inject, Injectable } from '@nestjs/common';
import { ProfileNotOwnedError } from '../domain/access.errors';
import type { AuthenticatedSession, ProfileKind } from '../domain/authenticated-session';
import { homeFor } from '../domain/profiles';
import { PROFILE_DIRECTORY, type ProfileDirectory } from './ports/profile-directory.port';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';

/** Escolhe o perfil ativo da sessão, sem novo login (RN14 e RN16 de Login). */
@Injectable()
export class SetActiveProfile {
  constructor(
    @Inject(PROFILE_DIRECTORY) private readonly profiles: ProfileDirectory,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute({
    session,
    profile,
  }: {
    session: AuthenticatedSession;
    profile: ProfileKind;
  }): Promise<{ activeProfile: ProfileKind; home: string }> {
    const owned = await this.profiles.listProfiles({ userId: session.userId });
    if (!owned.includes(profile)) throw new ProfileNotOwnedError();
    await this.sessions.setActiveProfile({
      sessionId: session.sessionId,
      userId: session.userId,
      profile,
    });
    return { activeProfile: profile, home: homeFor({ profile }) };
  }
}
