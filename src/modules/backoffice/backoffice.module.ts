import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ipHasherProvider } from '../logs/infrastructure/ip-hasher.provider';
import { AdminInsights, SEARCH_TERM_HASHER } from './application/admin-insights.use-cases';
import { AdminWeddings } from './application/admin-weddings.use-cases';
import { ADMIN_INSIGHTS_READER } from './application/ports/admin-insights.reader.port';
import { PrismaAdminInsightsReader } from './infrastructure/backoffice/prisma-admin-insights.reader';
import { HmacSearchTermHasher } from './infrastructure/hmac-search-term-hasher';
import { AdminInsightsController } from './presentation/admin-insights.controller';
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
  controllers: [AdminWeddingsController, AdminInsightsController],
  providers: [
    { provide: STAFF_DIRECTORY, useClass: PrismaStaffDirectory },
    StaffGuard,
    ipHasherProvider,
    adminLogWriterProvider,
    { provide: ADMIN_WEDDINGS_READER, useClass: PrismaAdminWeddingsReader },
    AdminWeddings,
    { provide: ADMIN_INSIGHTS_READER, useClass: PrismaAdminInsightsReader },
    { provide: SEARCH_TERM_HASHER, useClass: HmacSearchTermHasher },
    AdminInsights,
  ],
})
export class BackofficeModule {}
