/** O que o expurgo apagou de vez numa execução (Lixeira RN10 e RN11). */
export interface PurgeCounts {
  parties: number;
  guests: number;
  tags: number;
}

/**
 * Apaga de vez, em todos os casamentos, o que está na lixeira e cujo dia de
 * hoje, no fuso do casamento, já passou do purgeAt (deletedAt + 30 dias).
 */
export interface TrashPurge {
  purgeDue({ now }: { now: Date }): Promise<PurgeCounts>;
}

export const TRASH_PURGE = Symbol('TrashPurge');
