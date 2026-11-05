import { Inject, Injectable } from '@nestjs/common';
import { applicationLogRetentionCutoff } from '../domain/application-log-retention';
import {
  APPLICATION_LOG_RETENTION,
  type ApplicationLogRetention,
} from './ports/application-log-retention.port';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from './ports/application-log-writer.port';

export const APPLICATION_LOG_PURGED_ACTION = 'application_log.purged';

/**
 * Apaga o log da aplicação com mais de 5 anos (decisão 137) e registra a
 * execução no próprio log, mesmo sem nada a apagar: toda rotina com BYPASSRLS
 * fica registrada (ADR de multi-tenant, item 5). O registro novo é recente e
 * não entra no corte.
 */
@Injectable()
export class PurgeExpiredApplicationLogs {
  constructor(
    @Inject(APPLICATION_LOG_RETENTION) private readonly retention: ApplicationLogRetention,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ deleted: number; cutoff: Date }> {
    const cutoff = applicationLogRetentionCutoff({ now });
    const deleted = await this.retention.deleteCreatedBefore({ cutoff });
    await this.applicationLog.record({
      entry: {
        action: APPLICATION_LOG_PURGED_ACTION,
        actorKind: 'system',
        data: { deleted, cutoff: cutoff.toISOString() },
      },
    });
    return { deleted, cutoff };
  }
}
