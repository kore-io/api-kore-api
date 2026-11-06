import type { ProfileKind } from './authenticated-session';

export const PROFILE_KINDS: readonly ProfileKind[] = ['couple', 'planner', 'seller'];

/**
 * Perfis da conta (RN14 e RN15 de Login; decisão 177, item 4): casal com vínculo
 * de dono num casamento não expurgado; cerimonialista ou vendedor com o
 * indicador daquele tipo ativo (inativo ou bloqueado não dá perfil).
 */
export function profilesOf({
  ownsActiveWedding,
  referrer,
}: {
  ownsActiveWedding: boolean;
  referrer: { kind: 'planner' | 'seller'; status: 'active' | 'blocked' | 'inactive' } | null;
}): ProfileKind[] {
  return [
    ...(ownsActiveWedding ? (['couple'] as const) : []),
    ...(referrer?.status === 'active' ? [referrer.kind] : []),
  ];
}

/** A página inicial de cada perfil no app (decisões 146, 173 e 177, item 3). */
const HOME_BY_PROFILE: Record<ProfileKind, string> = {
  couple: '/app',
  planner: '/cerimonialista',
  seller: '/vendedor',
};

export function homeFor({ profile }: { profile: ProfileKind }): string {
  return HOME_BY_PROFILE[profile];
}
