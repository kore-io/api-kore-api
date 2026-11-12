/** A retenção da central (Central RN08), pela conexão do backoffice. */
export interface NotificationRetention {
  /** Apaga as lidas antes de `readBefore`; devolve quantas. */
  deleteRead({ readBefore }: { readBefore: Date }): Promise<number>;
}

export const NOTIFICATION_RETENTION = Symbol('NotificationRetention');
