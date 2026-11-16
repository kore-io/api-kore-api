/**
 * Limite de execuções simultâneas nesta instância, com fila em memória (ex.:
 * no máximo 2 processamentos de imagem ao mesmo tempo, S4 RN05).
 */
export class Semaphore {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.running += 1;
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      // A vaga passa direto para o próximo da fila, sem descer o contador.
      if (next) next();
      else this.running -= 1;
    }
  }
}
