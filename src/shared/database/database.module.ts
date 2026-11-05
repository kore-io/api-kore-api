import { Global, Module } from '@nestjs/common';
import { BackofficePrismaService } from './backoffice-prisma.service';
import { PrismaService } from './prisma.service';
import { TenantTransaction } from './tenant-transaction';

@Global()
@Module({
  providers: [PrismaService, BackofficePrismaService, TenantTransaction],
  exports: [PrismaService, BackofficePrismaService, TenantTransaction],
})
export class DatabaseModule {}
