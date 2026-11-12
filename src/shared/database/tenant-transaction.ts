import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../../generated/prisma/client';
import type { AfterCommit } from './after-commit.port';
import { PrismaService } from './prisma.service';

const logger = new Logger('TenantTransaction');

/** O casamento no ar, lido na primeira consulta da transação do grupo (RSVP RN13). */
export interface PartyTransactionContext {
  status: 'published' | 'post_event' | 'grace';
  timezone: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  /** AAAA-MM-DD. */
  rsvpDeadline: string | null;
  publishedAt: string | null;
  songQuestionEnabled: boolean;
  songQuestionText: string | null;
  contactWhatsapp: string | null;
  contactEmail: string | null;
}

/**
 * O grupo do cookie deixou de valer entre a leitura e a escrita: link
 * regenerado, grupo na lixeira ou casamento fora do ar (RSVP RN11).
 */
export class PartyTransactionRevokedError extends Error {
  constructor() {
    super('O grupo do cookie não vale mais.');
    this.name = 'PartyTransactionRevokedError';
  }
}

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
    return this.transaction({
      settings: { 'app.user_id': userId, ...(weddingId ? { 'app.wedding_id': weddingId } : {}) },
      work: () => work(),
    });
  }

  private async transaction<T>({
    settings,
    work,
  }: {
    settings: Record<string, string>;
    work: (tx: Prisma.TransactionClient) => Promise<T>;
  }): Promise<T> {
    const afterCommit: (() => Promise<void>)[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of Object.entries(settings))
        await tx.$queryRaw`SELECT set_config(${key}, ${value}, true)`;
      return this.current.run({ tx, afterCommit }, () => work(tx));
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

  /**
   * Transação do grupo (RSVP RN13; decisão 217(a)): sem pessoa, com
   * app.wedding_id e app.party_id, no papel kore_party, sob as policies
   * *_party_* daquele grupo. A
   * primeira consulta reconfere casamento, grupo, versão do link, lixeira e o
   * casamento no ar; se não vale mais, nada roda e sai
   * PartyTransactionRevokedError. O schedule() vale como na run().
   */
  async runAsParty<T>({
    weddingId,
    partyId,
    linkVersion,
    work,
  }: {
    weddingId: string;
    partyId: string;
    linkVersion: number;
    work: (context: PartyTransactionContext) => Promise<T>;
  }): Promise<T> {
    return this.transaction({
      settings: { 'app.wedding_id': weddingId, 'app.party_id': partyId },
      work: async (tx) => {
        // O papel do grupo: só os GRANTs e as policies *_party_* (sem herdar o kore_app).
        await tx.$executeRaw`SET LOCAL ROLE kore_party`;
        const [row] = await tx.$queryRaw<[{ context: PartyTransactionContext | null }]>`
          SELECT party_transaction_context(${linkVersion}::int) AS context`;
        if (!row?.context) throw new PartyTransactionRevokedError();
        return work(row.context);
      },
    });
  }

  client(): Prisma.TransactionClient {
    return this.request().tx;
  }

  /** A transação da requisição, quando há uma (rota pública não tem). */
  optionalClient(): Prisma.TransactionClient | undefined {
    return this.current.getStore()?.tx;
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
