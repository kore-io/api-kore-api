import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';
import type { AfterCommit } from './after-commit.port';
import { PrismaService } from './prisma.service';

const logger = new Logger('TenantTransaction');

interface RequestTransaction {
  tx: Prisma.TransactionClient;
  afterCommit: (() => Promise<void>)[];
}

/**
 * Transação da requisição com a RLS ligada (ADR de multi-tenant; decisão 153):
 * SET LOCAL app.user_id (e app.wedding_id nas rotas de um casamento) vale só
 * dentro dela, então nada vaza para a próxima requisição na mesma conexão.
 * Os repositórios das tabelas do casamento usam client(), que só existe aqui
 * dentro: fora dela, nenhuma consulta às tabelas do casamento acontece.
 *
 * Atenção: um erro que sai da rota desfaz tudo o que ela gravou na transação.
 * Quando uma escrita tem de ficar mesmo com a resposta de erro (como a
 * tentativa errada da RN05 de Login), o caso de uso devolve o resultado como
 * valor e só vira erro depois de a transação terminar.
 *
 * O que sai do banco (e-mail, evento de produto) é agendado com schedule() e
 * roda só depois do commit (decisão 170).
 */
@Injectable()
export class TenantTransaction implements AfterCommit {
  private readonly current = new AsyncLocalStorage<RequestTransaction>();

  constructor(private readonly prisma: PrismaService) {}

  async run<T>({
    userId,
    weddingId,
    work,
  }: {
    userId: string;
    weddingId?: string;
    work: () => Promise<T>;
  }): Promise<T> {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      if (weddingId) await tx.$queryRaw`SELECT set_config('app.wedding_id', ${weddingId}, true)`;
      return this.current.run({ tx, afterCommit }, work);
    });
    // Depois do commit: a falha de um envio não desfaz o que já foi gravado
    // nem muda a resposta; fica no log (só o tipo do erro, decisão 134).
    for (const task of afterCommit) {
      try {
        await task();
      } catch (error) {
        logger.error(`Tarefa depois do commit falhou (${(error as Error).name}).`);
      }
    }
    return result;
  }

  client(): Prisma.TransactionClient {
    return this.request().tx;
  }

  schedule(work: () => Promise<void>): void {
    this.request().afterCommit.push(work);
  }

  private request(): RequestTransaction {
    const request = this.current.getStore();
    if (!request) throw new Error('Consulta ao casamento fora da transação da requisição.');
    return request;
  }
}
