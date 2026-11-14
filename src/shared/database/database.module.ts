import { SupportContext } from './support-context';
import { Global, Module } from '@nestjs/common';
import { BackofficePrismaService } from './backoffice-prisma.service';
import { PrismaService } from './prisma.service';
import { AFTER_COMMIT } from './after-commit.port';
import { TenantTransaction } from './tenant-transaction';
import { BackofficeTransaction } from './backoffice-transaction';

@Global()
@Module({
  providers: [
    PrismaService,
    BackofficePrismaService,
    SupportContext,
    TenantTransaction,
    BackofficeTransaction,
    { provide: AFTER_COMMIT, useExisting: TenantTransaction },
  ],
  exports: [
    SupportContext,
    PrismaService,
    BackofficePrismaService,
    TenantTransaction,
    BackofficeTransaction,
    AFTER_COMMIT,
  ],
})
export class DatabaseModule {}
