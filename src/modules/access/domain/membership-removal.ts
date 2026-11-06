import type { MembershipRole } from './wedding-authorization';

export type RemovalRefusal = 'action_not_allowed' | 'cannot_remove_owner' | 'last_owner';

/**
 * RN06 e RN07 de Papéis: o dono remove o colaborador; qualquer pessoa encerra o
 * próprio vínculo (sair), menos o último dono; um dono não remove o outro.
 */
export function removalRefusal({
  requesterId,
  requesterRole,
  target,
  activeOwners,
}: {
  requesterId: string;
  requesterRole: MembershipRole;
  target: { userId: string; role: MembershipRole };
  activeOwners: number;
}): RemovalRefusal | null {
  if (target.userId === requesterId)
    return target.role === 'owner' && activeOwners <= 1 ? 'last_owner' : null;
  if (requesterRole !== 'owner') return 'action_not_allowed';
  if (target.role === 'owner') return 'cannot_remove_owner';
  return null;
}
