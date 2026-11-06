/** Atividade da RN13 de Convites por acesso ao casamento (decisões 136 e 180). */
export interface WeddingActivity {
  /** Grava agora como última atividade (e zera o aviso), se a anterior tiver mais de 1 hora. */
  touch({ weddingId, now }: { weddingId: string; now: Date }): Promise<void>;
}

export const WEDDING_ACTIVITY = Symbol('WeddingActivity');
