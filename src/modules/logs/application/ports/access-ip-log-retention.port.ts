/** Apaga do log de IP real o que ocorreu antes do corte; devolve quantos apagou. */
export interface AccessIpLogRetention {
  deleteOccurredBefore({ cutoff }: { cutoff: Date }): Promise<number>;
}

export const ACCESS_IP_LOG_RETENTION = Symbol('AccessIpLogRetention');
