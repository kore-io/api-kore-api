/**
 * Cache em memória das chaves de dados já decifradas pelo KMS, para não chamar
 * o KMS a cada leitura (ADR da chave Pix e do CPF-CNPJ). A chave vencida sai na
 * leitura, e o teto de entradas tira a usada há mais tempo (LRU). Ao sair, a
 * chave é zerada no buffer, para não ficar aberta na memória.
 */
export class DataKeyCache {
  // O Map guarda a ordem de inserção: a primeira entrada é a usada há mais tempo.
  private readonly entries = new Map<string, { key: Buffer; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor({
    ttlMs,
    maxEntries,
    now = Date.now,
  }: {
    ttlMs: number;
    maxEntries: number;
    now?: () => number;
  }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get size(): number {
    return this.entries.size;
  }

  get({ id }: { id: string }): Buffer | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    if (entry.expiresAt <= this.now()) {
      entry.key.fill(0);
      return undefined;
    }
    // Reinsere no fim: passa a ser a usada mais recentemente.
    this.entries.set(id, entry);
    // Cópia: se a entrada sair do cache durante um decrypt em andamento, zerar
    // o buffer guardado não afeta quem já leu a chave.
    return Buffer.from(entry.key);
  }

  /** Guarda uma cópia: quem chamou continua dono do buffer que passou. */
  set({ id, key }: { id: string; key: Buffer }): void {
    this.entries.get(id)?.key.fill(0);
    this.entries.delete(id);
    this.entries.set(id, { key: Buffer.from(key), expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const [oldestId, oldest] = this.entries.entries().next().value as [
        string,
        { key: Buffer; expiresAt: number },
      ];
      oldest.key.fill(0);
      this.entries.delete(oldestId);
    }
  }
}
