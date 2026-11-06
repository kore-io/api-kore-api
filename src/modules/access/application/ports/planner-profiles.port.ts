/** Perfil mínimo do cerimonialista no aceite (RN10 de Convites; decisão 135, item 6). */
export interface PlannerProfiles {
  /** O tipo do perfil de indicador da pessoa, se houver. */
  referrerKind({ userId }: { userId: string }): Promise<'planner' | 'seller' | null>;
  /**
   * Cria Referrer (planner, ativo, comissão padrão), Planner (creditName = nome)
   * e a Organization de 1 membro (owner), com o código de indicação livre.
   */
  createMinimal({ userId, name, now }: { userId: string; name: string; now: Date }): Promise<void>;
}

export const PLANNER_PROFILES = Symbol('PlannerProfiles');
