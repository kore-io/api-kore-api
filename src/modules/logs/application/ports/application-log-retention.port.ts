/** Apaga do log da aplicação o que foi criado antes do corte; devolve quantos apagou. */
export interface ApplicationLogRetention {
  deleteCreatedBefore({ cutoff }: { cutoff: Date }): Promise<number>;
}

export const APPLICATION_LOG_RETENTION = Symbol('ApplicationLogRetention');
