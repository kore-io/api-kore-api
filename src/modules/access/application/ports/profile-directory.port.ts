import type { ProfileKind } from '../../domain/authenticated-session';

/** Perfis da pessoa (RN14 de Login): casal, cerimonialista ou vendedor. */
export interface ProfileDirectory {
  listProfiles({ userId }: { userId: string }): Promise<ProfileKind[]>;
}

export const PROFILE_DIRECTORY = Symbol('ProfileDirectory');
