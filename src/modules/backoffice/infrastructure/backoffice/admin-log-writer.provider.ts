import type { Provider } from '@nestjs/common';
import { BackofficePrismaService } from '@/shared/database/backoffice-prisma.service';
import { IpHasher } from '@/modules/logs/infrastructure/providers/ip-hasher';
import { PrismaApplicationLogWriter } from '@/modules/logs/infrastructure/persistence/prisma-application-log-writer';
import { ADMIN_LOG_WRITER } from '@/modules/backoffice/application/admin-weddings.use-cases';

/** O log do staff pela conexão do backoffice: as rotas /v1/admin não têm casamento na transação. */
export const adminLogWriterProvider: Provider = {
  provide: ADMIN_LOG_WRITER,
  inject: [BackofficePrismaService, IpHasher],
  useFactory: (client: BackofficePrismaService, ipHasher: IpHasher) =>
    new PrismaApplicationLogWriter({ client: () => client, ipHasher }),
};
