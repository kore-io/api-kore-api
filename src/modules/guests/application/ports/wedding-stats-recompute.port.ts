/** Recalcula os números de todo casamento a partir do Guest; devolve quantos corrigiu. */
export interface WeddingStatsRecompute {
  recomputeAll(): Promise<number>;
}

export const WEDDING_STATS_RECOMPUTE = Symbol('WeddingStatsRecompute');
