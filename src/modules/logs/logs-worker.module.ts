import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BackofficePrismaService } from '../../shared/database/backoffice-prisma.service';
import { ACCESS_IP_LOG_RETENTION } from './application/ports/access-ip-log-retention.port';
import { APPLICATION_LOG_WRITER } from './application/ports/application-log-writer.port';
import { PurgeExpiredAccessIpLogs } from './application/purge-expired-access-ip-logs.use-case';
import {
  ACCESS_IP_RETENTION_QUEUE,
  AccessIpRetentionProcessor,
  AccessIpRetentionScheduler,
} from './infrastructure/access-ip-retention.job';
import { PrismaAccessIpLogRetention } from './infrastructure/backoffice/prisma-access-ip-log-retention';
import { IpHasher } from './infrastructure/ip-hasher';
import { ipHasherProvider } from './infrastructure/ip-hasher.provider';
import { PrismaApplicationLogWriter } from './infrastructure/prisma-application-log-writer';

/**
 * Rotina diária de retenção do IP real, do lado do worker (decisões 116 e 135).
 * Roda com BYPASSRLS, então registra cada execução no log da aplicação pela
 * mesma conexão do backoffice (ADR de multi-tenant, item 5).
 */
@Module({
  imports: [BullModule.registerQueue({ name: ACCESS_IP_RETENTION_QUEUE })],
  providers: [
    ipHasherProvider,
    {
      provide: APPLICATION_LOG_WRITER,
      inject: [BackofficePrismaService, IpHasher],
      useFactory: (client: BackofficePrismaService, ipHasher: IpHasher) =>
        new PrismaApplicationLogWriter({ client, ipHasher }),
    },
    { provide: ACCESS_IP_LOG_RETENTION, useClass: PrismaAccessIpLogRetention },
    PurgeExpiredAccessIpLogs,
    AccessIpRetentionProcessor,
    AccessIpRetentionScheduler,
  ],
})
export class LogsWorkerModule {}
