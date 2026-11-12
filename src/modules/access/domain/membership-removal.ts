import type { MembershipRole } from './wedding-authorization';

export type RemovalRefusal =
  'action_not_allowed' | 'cannot_remove_owner' | 'last_owner' | 'wedding_has_no_owner';

/**
 * RN06 e RN07 de Papéis: o dono remove o colaborador; qualquer pessoa encerra o
 * próprio vínculo (sair), menos o último dono; um dono não remove o outro.
 * Decisão 224(1): o colaborador não sai de um casamento sem dono ativo (o
 * caminho é excluir o casamento); senão o casamento fica sem vínculo nenhum e
 * abre a brecha da autoindicação (sair e aceitar o próprio link).
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
  if (target.userId === requesterId) {
    if (target.role === 'owner') return activeOwners <= 1 ? 'last_owner' : null;
    return activeOwners === 0 ? 'wedding_has_no_owner' : null;
  }
  if (requesterRole !== 'owner') return 'action_not_allowed';
  if (target.role === 'owner') return 'cannot_remove_owner';
  return null;
}
