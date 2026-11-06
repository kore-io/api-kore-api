import type { ProfileKind } from '../../domain/authenticated-session';

/** Um vínculo ativo da pessoa, como os cartões da Seleção de perfil mostram (decisão 174). */
export interface MembershipSummary {
  weddingId: string;
  role: 'owner' | 'collaborator';
  /** Primeiros nomes dos noivos ("Ana & Marcos"; decisões 163 e 177). */
  weddingName: string;
  eventDate: Date | null;
  city: string;
  state: string;
}

export interface AccountOverview {
  memberships: MembershipSummary[];
  profiles: ProfileKind[];
  /** Com perfil de cerimonialista: a assessoria e quantos casamentos (decisão 174). */
  planner: { organization: string; weddingsCount: number } | null;
  referrer: { kind: 'planner' | 'seller'; referralCode: string } | null;
}

/** Perfis da pessoa (RN14 de Login): casal, cerimonialista ou vendedor. */
export interface ProfileDirectory {
  listProfiles({ userId }: { userId: string }): Promise<ProfileKind[]>;
  overview({ userId }: { userId: string }): Promise<AccountOverview>;
}

export const PROFILE_DIRECTORY = Symbol('ProfileDirectory');
