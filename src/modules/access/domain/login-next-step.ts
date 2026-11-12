export type LoginOrigin = 'invite' | 'referral' | 'couple_signup' | 'planner_signup' | 'none';
export type LoginNext = 'home' | 'choose_profile' | 'couple_signup' | 'planner_signup' | 'invite';

/**
 * O que se guarda da origem do login. O token do convite de acesso nunca vai
 * ao banco (RN03 de Convites: só o hash do token é guardado): o app o guarda no
 * aparelho e volta ao convite depois do login (decisão 142). O código de
 * indicação, que é público, fica.
 */
export function storableOriginRef({
  origin,
  originRef,
}: {
  origin: LoginOrigin;
  originRef: string | null;
}): string | null {
  return origin === 'invite' ? null : originRef;
}

/**
 * RN06 de Login: depois de confirmar o e-mail, a pessoa segue pela origem;
 * sem origem, vale a Seleção de perfil (RN14): um perfil entra direto, mais de
 * um ou nenhum escolhe.
 */
export function loginNextStep({
  origin,
  profileCount,
}: {
  origin: LoginOrigin;
  profileCount: number;
}): LoginNext {
  switch (origin) {
    case 'invite':
      return 'invite';
    case 'referral':
    case 'couple_signup':
      return 'couple_signup';
    case 'planner_signup':
      return 'planner_signup';
    case 'none':
      return profileCount === 1 ? 'home' : 'choose_profile';
  }
}
