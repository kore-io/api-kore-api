import { Inject, Injectable } from '@nestjs/common';
import { accessIpRetentionCutoff } from '../domain/access-ip-retention';
import {
  ACCESS_IP_LOG_RETENTION,
  type AccessIpLogRetention,
} from './ports/access-ip-log-retention.port';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from './ports/application-log-writer.port';

export const ACCESS_IP_LOG_PURGED_ACTION = 'access_ip_log.purged';

/**
 * Apaga o IP real que passou dos 6 meses de guarda (decisão 116) e registra a
 * execução no log da aplicação, mesmo sem nada a apagar: toda rotina com
 * BYPASSRLS fica registrada (ADR de multi-tenant, item 5; decisão 137).
 */
@Injectable()
export class PurgeExpiredAccessIpLogs {
  constructor(
    @Inject(ACCESS_IP_LOG_RETENTION) private readonly retention: AccessIpLogRetention,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ deleted: number; cutoff: Date }> {
    const cutoff = accessIpRetentionCutoff({ now });
    const deleted = await this.retention.deleteOccurredBefore({ cutoff });
    await this.applicationLog.record({
      entry: {
        action: ACCESS_IP_LOG_PURGED_ACTION,
        actorKind: 'system',
        data: { deleted, cutoff: cutoff.toISOString() },
      },
    });
    return { deleted, cutoff };
  }
}
