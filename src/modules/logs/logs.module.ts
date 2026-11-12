import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { TenantTransaction } from '../../shared/database/tenant-transaction';
import { ACCESS_IP_LOG_WRITER } from './application/ports/access-ip-log-writer.port';
import { APPLICATION_LOG_WRITER } from './application/ports/application-log-writer.port';
import { IpHasher } from './infrastructure/ip-hasher';
import { ipHasherProvider } from './infrastructure/ip-hasher.provider';
import { PrismaAccessIpLogWriter } from './infrastructure/prisma-access-ip-log-writer';
import { PrismaApplicationLogWriter } from './infrastructure/prisma-application-log-writer';

/**
 * Log da aplicação e log de IP real (decisão 116), do lado da API. Global:
 * qualquer módulo registra pelas portas APPLICATION_LOG_WRITER e
 * ACCESS_IP_LOG_WRITER. A retenção roda no worker (LogsWorkerModule).
 */
@Global()
@Module({
  providers: [
    ipHasherProvider,
    {
      provide: APPLICATION_LOG_WRITER,
      inject: [PrismaService, TenantTransaction, IpHasher],
      useFactory: (prisma: PrismaService, tenant: TenantTransaction, ipHasher: IpHasher) =>
        new PrismaApplicationLogWriter({
          client: () => tenant.optionalClient() ?? prisma,
          ipHasher,
        }),
    },
    { provide: ACCESS_IP_LOG_WRITER, useClass: PrismaAccessIpLogWriter },
  ],
  exports: [APPLICATION_LOG_WRITER, ACCESS_IP_LOG_WRITER],
})
export class LogsModule {}
