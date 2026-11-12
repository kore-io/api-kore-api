import type { PlannerProfiles } from '../../access/application/ports/planner-profiles.port';
import { ProfileNotOwnedError } from '../../access/domain/access.errors';

/**
 * As rotas da cerimonialista exigem ter o perfil (Referrer planner ativo), não
 * estar nele na sessão (decisão 224(3)): sem ele, 403 PROFILE_NOT_OWNED.
 */
export async function requirePlannerProfile({
  profiles,
  userId,
}: {
  profiles: PlannerProfiles;
  userId: string;
}): Promise<void> {
  if (!(await profiles.findOwn({ userId }))) throw new ProfileNotOwnedError();
}
