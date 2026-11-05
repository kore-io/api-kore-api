import type { Prisma, PrismaClient } from '../../../generated/prisma/client';
import type { ApplicationLogWriter } from '../application/ports/application-log-writer.port';
import type { ApplicationLogEntry } from '../domain/log-entries';
import { IpHasher } from './ip-hasher';

/**
 * Grava no log da aplicação pela conexão recebida: a da API (kore_app) ou a
 * do backoffice e das rotinas (kore_backoffice), que registram ali cada acesso
 * com BYPASSRLS (ADR de multi-tenant, item 5).
 */
export class PrismaApplicationLogWriter implements ApplicationLogWriter {
  private readonly client: PrismaClient;
  private readonly ipHasher: IpHasher;

  constructor({ client, ipHasher }: { client: PrismaClient; ipHasher: IpHasher }) {
    this.client = client;
    this.ipHasher = ipHasher;
  }

  async record({ entry }: { entry: ApplicationLogEntry }): Promise<void> {
    const { ip, data, ...fields } = entry;
    // createMany não usa RETURNING: a API só tem INSERT nesta tabela (só inserção).
    await this.client.applicationLog.createMany({
      data: [
        {
          ...fields,
          data: data as Prisma.InputJsonValue | undefined,
          ipHash: ip ? this.ipHasher.hash({ ip }) : undefined,
        },
      ],
    });
  }
}
