import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';
import type { AfterCommit } from './after-commit.port';
import { BackofficePrismaService } from './backoffice-prisma.service';

const logger = new Logger('BackofficeTransaction');

interface CurrentTransaction {
  tx: Prisma.TransactionClient;
  afterCommit: (() => Promise<void>)[];
}

/**
 * Transação do backoffice e do worker (kore_backoffice, fora da RLS por
 * casamento) com "depois do commit" (Publicar e pagar RN05; revisão técnica
 * G5): o e-mail, o evento de produto e as chamadas ao gateway (RN19) só saem
 * do que o banco gravou. Uma transação desfeita descarta o que foi agendado.
 *
 * Quem trava mais de uma linha segue a ordem única da RN18: Wedding →
 * Payment → Referrer → Payout → Commission.
 */
@Injectable()
export class BackofficeTransaction implements AfterCommit {
  private readonly current = new AsyncLocalStorage<CurrentTransaction>();

  constructor(private readonly db: BackofficePrismaService) {}

  async run<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.db.$transaction((tx) =>
      this.current.run({ tx, afterCommit }, () => work(tx)),
    );
    // A falha de uma tarefa não desfaz o que já foi gravado; fica no log, só
    // com o tipo do erro (decisão 134).
    for (const task of afterCommit) {
      try {
        await task();
      } catch (error) {
        logger.error(`Tarefa depois do commit falhou (${(error as Error).name}).`);
      }
    }
    return result;
  }

  /** O cliente da transação corrente; fora dela, erro (nada escapa da transação). */
  client(): Prisma.TransactionClient {
    const current = this.current.getStore();
    if (!current) throw new Error('Consulta fora da transação do backoffice.');
    return current.tx;
  }

  schedule(work: () => Promise<void>): void {
    const current = this.current.getStore();
    if (!current) throw new Error('Agendamento fora da transação do backoffice.');
    current.afterCommit.push(work);
  }
}
