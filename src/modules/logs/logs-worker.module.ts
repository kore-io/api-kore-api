import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BackofficePrismaService } from '../../shared/database/backoffice-prisma.service';
import { ACCESS_IP_LOG_RETENTION } from './application/ports/access-ip-log-retention.port';
import { APPLICATION_LOG_RETENTION } from './application/ports/application-log-retention.port';
import { APPLICATION_LOG_WRITER } from './application/ports/application-log-writer.port';
import { PurgeExpiredAccessIpLogs } from './application/purge-expired-access-ip-logs.use-case';
import { PurgeExpiredApplicationLogs } from './application/purge-expired-application-logs.use-case';
import {
  ACCESS_IP_RETENTION_QUEUE,
  AccessIpRetentionProcessor,
  AccessIpRetentionScheduler,
} from './infrastructure/access-ip-retention.job';
import {
  APPLICATION_LOG_RETENTION_QUEUE,
  ApplicationLogRetentionProcessor,
  ApplicationLogRetentionScheduler,
} from './infrastructure/application-log-retention.job';
import { PrismaAccessIpLogRetention } from './infrastructure/backoffice/prisma-access-ip-log-retention';
import { PrismaApplicationLogRetention } from './infrastructure/backoffice/prisma-application-log-retention';
import { IpHasher } from './infrastructure/ip-hasher';
import { ipHasherProvider } from './infrastructure/ip-hasher.provider';
import { PrismaApplicationLogWriter } from './infrastructure/prisma-application-log-writer';

/**
 * Rotinas diárias de retenção, do lado do worker: IP real em 6 meses (decisão
 * 116) e log da aplicação em 5 anos (decisão 137). Rodam com BYPASSRLS, então
 * registram cada execução no log da aplicação pela mesma conexão do backoffice
 * (ADR de multi-tenant, item 5).
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: ACCESS_IP_RETENTION_QUEUE },
      { name: APPLICATION_LOG_RETENTION_QUEUE },
    ),
  ],
  providers: [
    ipHasherProvider,
    {
      provide: APPLICATION_LOG_WRITER,
      inject: [BackofficePrismaService, IpHasher],
      useFactory: (client: BackofficePrismaService, ipHasher: IpHasher) =>
        new PrismaApplicationLogWriter({ client: () => client, ipHasher }),
    },
    { provide: ACCESS_IP_LOG_RETENTION, useClass: PrismaAccessIpLogRetention },
    PurgeExpiredAccessIpLogs,
    AccessIpRetentionProcessor,
    AccessIpRetentionScheduler,
    { provide: APPLICATION_LOG_RETENTION, useClass: PrismaApplicationLogRetention },
    PurgeExpiredApplicationLogs,
    ApplicationLogRetentionProcessor,
    ApplicationLogRetentionScheduler,
  ],
  // Outras rotinas do worker registram a execução pelo mesmo writer.
  exports: [APPLICATION_LOG_WRITER],
})
export class LogsWorkerModule {}
