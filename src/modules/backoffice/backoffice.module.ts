import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ipHasherProvider } from '../logs/infrastructure/ip-hasher.provider';
import { AdminWeddings } from './application/admin-weddings.use-cases';
import { adminLogWriterProvider } from './infrastructure/backoffice/admin-log-writer.provider';
import { ADMIN_WEDDINGS_READER } from './application/ports/admin-weddings.reader.port';
import { STAFF_DIRECTORY } from './application/ports/staff-directory.port';
import { PrismaAdminWeddingsReader } from './infrastructure/backoffice/prisma-admin-weddings.reader';
import { PrismaStaffDirectory } from './infrastructure/backoffice/prisma-staff-directory';
import { AdminWeddingsController } from './presentation/admin-weddings.controller';
import { StaffGuard } from './presentation/staff.guard';

/**
 * O Backoffice da equipe do Kore (/v1/admin; Backoffice - acesso), pela
 * conexão do backoffice (decisão 180(5)), atrás do StaffGuard.
 */
@Module({
  imports: [BillingModule],
  controllers: [AdminWeddingsController],
  providers: [
    { provide: STAFF_DIRECTORY, useClass: PrismaStaffDirectory },
    StaffGuard,
    ipHasherProvider,
    adminLogWriterProvider,
    { provide: ADMIN_WEDDINGS_READER, useClass: PrismaAdminWeddingsReader },
    AdminWeddings,
  ],
})
export class BackofficeModule {}
