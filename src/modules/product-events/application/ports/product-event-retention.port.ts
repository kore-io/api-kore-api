/** Apaga os eventos ocorridos antes do corte; devolve quantos apagou. */
export interface ProductEventRetention {
  deleteOccurredBefore({ cutoff }: { cutoff: Date }): Promise<number>;
}

export const PRODUCT_EVENT_RETENTION = Symbol('ProductEventRetention');
