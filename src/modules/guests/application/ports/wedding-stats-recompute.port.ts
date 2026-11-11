/**
 * Recalcula os números dos casamentos que divergem do Guest (ou só de um).
 * corrected: quantos mudaram; skipped: quantos ficaram para a próxima noite
 * porque a linha estava presa por uma escrita longa demais.
 */
export interface WeddingStatsRecompute {
  recompute({ weddingId }: { weddingId?: string }): Promise<{ corrected: number; skipped: number }>;
}

export const WEDDING_STATS_RECOMPUTE = Symbol('WeddingStatsRecompute');
