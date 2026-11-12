/** Endereços já usados por algum casamento, inclusive os que a pessoa não vê (RN05). */
export interface SlugRegistry {
  isTaken({ slug }: { slug: string }): Promise<boolean>;

  /**
   * O endereço atual do casamento, pela RLS: sem vínculo, null (o weddingId é
   * ignorado, GET slug-availability; Dados básicos RN06).
   */
  currentSlugOf({ weddingId }: { weddingId: string }): Promise<string | null>;
}

export const SLUG_REGISTRY = Symbol('SlugRegistry');
