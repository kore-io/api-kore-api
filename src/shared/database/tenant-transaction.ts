import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

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
 */
@Injectable()
export class TenantTransaction {
  private readonly current = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaService) {}

  run<T>({
    userId,
    weddingId,
    work,
  }: {
    userId: string;
    weddingId?: string;
    work: () => Promise<T>;
  }): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      if (weddingId) await tx.$queryRaw`SELECT set_config('app.wedding_id', ${weddingId}, true)`;
      return this.current.run(tx, work);
    });
  }

  client(): Prisma.TransactionClient {
    const tx = this.current.getStore();
    if (!tx) throw new Error('Consulta ao casamento fora da transação da requisição.');
    return tx;
  }
}
