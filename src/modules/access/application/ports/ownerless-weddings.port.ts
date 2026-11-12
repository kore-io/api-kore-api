/** Um casamento aguardando o casal ou em rascunho, sem dono (RN13 de Convites). */
export interface OwnerlessWedding {
  weddingId: string;
  status: 'awaiting_couple' | 'draft';
  lastActivityAt: Date;
  noticeSentAt: Date | null;
  /** O indicador que criou o casamento, que recebe o aviso (e-mail 6). */
  creator: { email: string; name: string | null } | null;
  partnerNames: [string, string];
}

/**
 * Casamentos sem dono, pela conexão do backoffice (a rotina atravessa os
 * casamentos). Cada gravação confere de novo, sob lock, que a última atividade
 * é a mesma que a rotina leu: atividade nova no meio do caminho vence.
 */
export interface OwnerlessWeddings {
  listCandidates({ lastActivityBefore }: { lastActivityBefore: Date }): Promise<OwnerlessWedding[]>;
  /** Marca o aviso e registra no log, na mesma transação; false se algo mudou. */
  markNoticeSent({
    weddingId,
    seenLastActivityAt,
    now,
  }: {
    weddingId: string;
    seenLastActivityAt: Date;
    now: Date;
  }): Promise<boolean>;
  /**
   * O e-mail 6 não saiu (fila e envio direto fora, ou o worker desistiu): desfaz
   * a marca daquele aviso e registra no log, para a rotina tentar de novo
   * (decisão 180(8)). false se a marca já mudou.
   */
  clearNotice({
    weddingId,
    noticeSentAt,
  }: {
    weddingId: string;
    noticeSentAt: Date;
  }): Promise<boolean>;
  /**
   * Apaga convites, vínculos e noivos e deixa a lápide (id, status purged,
   * purgedAt, indicador, createdAt), com o registro no log, na mesma transação.
   */
  purge({
    weddingId,
    seenLastActivityAt,
    now,
  }: {
    weddingId: string;
    seenLastActivityAt: Date;
    now: Date;
  }): Promise<boolean>;
}

export const OWNERLESS_WEDDINGS = Symbol('OwnerlessWeddings');
