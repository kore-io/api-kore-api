/** Endereços já usados por algum casamento, inclusive os que a pessoa não vê (RN05). */
export interface SlugRegistry {
  isTaken({ slug }: { slug: string }): Promise<boolean>;
}

export const SLUG_REGISTRY = Symbol('SlugRegistry');
