export type LoginOrigin = 'invite' | 'referral' | 'couple_signup' | 'planner_signup' | 'none';
export type LoginNext = 'home' | 'choose_profile' | 'couple_signup' | 'planner_signup' | 'invite';

/**
 * RN06 de Login: depois de confirmar o e-mail, a pessoa segue pela origem;
 * sem origem, vale a Seleção de perfil (RN14): um perfil entra direto, mais de
 * um ou nenhum escolhe.
 */
export function loginNextStep({
  origin,
  originRef,
  profileCount,
}: {
  origin: LoginOrigin;
  originRef: string | null;
  profileCount: number;
}): { next: LoginNext; inviteToken?: string } {
  switch (origin) {
    case 'invite':
      if (originRef) return { next: 'invite', inviteToken: originRef };
      break;
    case 'referral':
    case 'couple_signup':
      return { next: 'couple_signup' };
    case 'planner_signup':
      return { next: 'planner_signup' };
    case 'none':
      break;
  }
  return { next: profileCount === 1 ? 'home' : 'choose_profile' };
}
