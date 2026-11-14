import { AdminPayments } from './application/admin-payments.use-cases';
import { ADMIN_PAYMENTS_READER } from './application/ports/admin-payments.reader.port';
import { PrismaAdminPaymentsReader } from './infrastructure/backoffice/prisma-admin-payments.reader';
import { AdminPaymentsController } from './presentation/admin-payments.controller';
import { AdminPayoutsController } from './presentation/admin-payouts.controller';
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ipHasherProvider } from '../logs/infrastructure/ip-hasher.provider';
import { AdminInsights, SEARCH_TERM_HASHER } from './application/admin-insights.use-cases';
import { AdminWeddings } from './application/admin-weddings.use-cases';
import { REFERRER_REASSIGNMENT } from './application/ports/referrer-reassignment.port';
import { ReassignReferrer } from './application/reassign-referrer.use-case';
import { EraseGuestOnRequest } from './application/erase-guest.use-case';
import { ChangeAccessEmail } from './application/change-access-email.use-cases';
import { ACCESS_EMAIL_CHANGES } from './application/ports/access-email-changes.port';
import { PrismaAccessEmailChanges } from './infrastructure/backoffice/prisma-access-email-changes';
import { AccessModule } from '../access/access.module';
import { GUEST_ERASURE } from './application/ports/guest-erasure.port';
import { PrismaGuestErasure } from './infrastructure/backoffice/prisma-guest-erasure';
import { PrismaReferrerReassignment } from './infrastructure/backoffice/prisma-referrer-reassignment';
import { ADMIN_INSIGHTS_READER } from './application/ports/admin-insights.reader.port';
import { PrismaAdminInsightsReader } from './infrastructure/backoffice/prisma-admin-insights.reader';
import { HmacSearchTermHasher } from './infrastructure/hmac-search-term-hasher';
import { AdminInsightsController } from './presentation/admin-insights.controller';
import { SupportSessions } from './application/support-sessions.use-cases';
import { SupportSessionsController } from './presentation/support-sessions.controller';
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
  imports: [BillingModule, AccessModule],
  controllers: [
    AdminPaymentsController,
    AdminPayoutsController,
    AdminWeddingsController,
    AdminInsightsController,
    SupportSessionsController,
  ],
  providers: [
    { provide: STAFF_DIRECTORY, useClass: PrismaStaffDirectory },
    StaffGuard,
    ipHasherProvider,
    adminLogWriterProvider,
    { provide: ADMIN_WEDDINGS_READER, useClass: PrismaAdminWeddingsReader },
    AdminWeddings,
    { provide: ADMIN_PAYMENTS_READER, useClass: PrismaAdminPaymentsReader },
    AdminPayments,
    { provide: REFERRER_REASSIGNMENT, useClass: PrismaReferrerReassignment },
    ReassignReferrer,
    { provide: GUEST_ERASURE, useClass: PrismaGuestErasure },
    EraseGuestOnRequest,
    { provide: ACCESS_EMAIL_CHANGES, useClass: PrismaAccessEmailChanges },
    ChangeAccessEmail,
    SupportSessions,
    { provide: ADMIN_INSIGHTS_READER, useClass: PrismaAdminInsightsReader },
    { provide: SEARCH_TERM_HASHER, useClass: HmacSearchTermHasher },
    AdminInsights,
  ],
})
export class BackofficeModule {}
