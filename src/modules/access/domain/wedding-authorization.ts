export type MembershipRole = 'owner' | 'collaborator';

/**
 * Ações sobre um casamento que a Fase 0 autoriza (Papéis e permissões). Cada
 * fase acrescenta as suas aqui, com a regra da spec.
 */
export type WeddingAction =
  /** Ver o casamento (RN01): qualquer vínculo ativo. */
  | 'view'
  /** Convidar o parceiro (RN02 de Convites): dono. */
  | 'invite_partner'
  /** Convidar o cerimonialista (RN02 de Convites): dono. */
  | 'invite_planner'
  /** Remover colaborador (RN02, RN03 e RN06 de Papéis): só o dono. */
  | 'remove_collaborator'
  /** Mexer na lista de convidados, tags e lixeira (Grupos RN02): qualquer vínculo (186(4)). */
  | 'manage_guests'
  /** Exportar a lista (Exportação RN07): qualquer vínculo (186(4)). */
  | 'export_guests'
  /** Mandar para a lixeira quem já respondeu (Lixeira RN07): só o dono (184(15)). */
  | 'trash_responded'
  /** Editar o site e enviar imagens (Dados básicos RN04; F2): qualquer vínculo. */
  | 'manage_site';

const OWNER_ONLY: ReadonlySet<WeddingAction> = new Set([
  'invite_partner',
  'invite_planner',
  'remove_collaborator',
  'trash_responded',
]);

/**
 * A matriz de papéis (RN02 a RN04 de Papéis): o dono faz tudo; o colaborador
 * (cerimonialista, ou vendedor antes do aceite) não gerencia colaboradores nem
 * convida. A autorização central é esta função; a RLS é a segunda barreira.
 */
export function roleAllows({
  role,
  action,
}: {
  role: MembershipRole;
  action: WeddingAction;
}): boolean {
  if (role === 'owner') return true;
  return !OWNER_ONLY.has(action);
}
