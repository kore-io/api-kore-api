/** Os papéis da equipe do Kore no Backoffice (Backoffice - acesso RN02; decisões 67 a 69). */
export type StaffRole = 'admin' | 'support';

/** Quem do staff faz a requisição, com o papel lido do banco nesta requisição (RN01). */
export interface StaffMember {
  userId: string;
  role: StaffRole;
}

/** Fora do staff (403 STAFF_ONLY): a resposta não diz qual dos motivos (RN01). */
export class StaffOnlyError extends Error {
  override name = 'StaffOnlyError';
}

/**
 * O guard do Backoffice (RN01): login pelo Google, com o `hd` verificado igual
 * ao domínio da empresa, e o papel `admin` ou `support` no banco. O e-mail
 * verificado já é exigido no login pelo Google.
 */
export function isStaffSession({
  authMethod,
  staffDomain,
  expectedDomain,
}: {
  authMethod: string;
  staffDomain: string | null;
  expectedDomain: string;
}): boolean {
  return authMethod === 'google' && staffDomain !== null && staffDomain === expectedDomain;
}
