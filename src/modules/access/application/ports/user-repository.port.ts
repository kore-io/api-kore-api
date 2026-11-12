import type { PlatformRole } from '../../domain/authenticated-session';

export interface UserProfile {
  id: string;
  name: string | null;
  email: string;
  platformRole: PlatformRole;
}

export interface UserRepository {
  findProfileById({ userId }: { userId: string }): Promise<UserProfile | null>;
}

export const USER_REPOSITORY = Symbol('UserRepository');
