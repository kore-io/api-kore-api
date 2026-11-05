import { Global, Module } from '@nestjs/common';
import { BackofficePrismaService } from './backoffice-prisma.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, BackofficePrismaService],
  exports: [PrismaService, BackofficePrismaService],
})
export class DatabaseModule {}
