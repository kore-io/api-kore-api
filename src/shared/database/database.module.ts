import { Global, Module } from '@nestjs/common';
import { BackofficePrismaService } from './backoffice-prisma.service';
import { PrismaService } from './prisma.service';
import { AFTER_COMMIT } from './after-commit.port';
import { TenantTransaction } from './tenant-transaction';

@Global()
@Module({
  providers: [
    PrismaService,
    BackofficePrismaService,
    TenantTransaction,
    { provide: AFTER_COMMIT, useExisting: TenantTransaction },
  ],
  exports: [PrismaService, BackofficePrismaService, TenantTransaction, AFTER_COMMIT],
})
export class DatabaseModule {}
