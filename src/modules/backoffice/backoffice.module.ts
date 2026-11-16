import { Module } from '@nestjs/common';
import { AccessModule } from '@/modules/access/access.module';
import { BillingModule } from '@/modules/billing/billing.module';
import { ipHasherProvider } from '@/modules/logs/infrastructure/providers/ip-hasher.provider';
import { AdminInsights, SEARCH_TERM_HASHER } from './application/admin-insights.use-cases';
import { AdminPayments } from './application/admin-payments.use-cases';
import { AdminReferrers } from './application/admin-referrers.use-cases';
import { AdminSettings } from './application/admin-settings.use-cases';
import { AdminWeddings } from './application/admin-weddings.use-cases';
import { ChangeAccessEmail } from './application/change-access-email.use-cases';
import { EraseGuestOnRequest } from './application/erase-guest.use-case';
import { ACCESS_EMAIL_CHANGES } from './application/ports/access-email-changes.port';
import { ADMIN_INSIGHTS_READER } from './application/ports/admin-insights.reader.port';
import { ADMIN_PAYMENTS_READER } from './application/ports/admin-payments.reader.port';
import { ADMIN_REFERRERS_READER } from './application/ports/admin-referrers.reader.port';
import { ADMIN_SETTINGS_STORE } from './application/ports/admin-settings.store.port';
import { ADMIN_WEDDINGS_READER } from './application/ports/admin-weddings.reader.port';
import { GUEST_ERASURE } from './application/ports/guest-erasure.port';
import { REFERRER_ADMIN_STORE } from './application/ports/referrer-admin.store.port';
import { REFERRER_REASSIGNMENT } from './application/ports/referrer-reassignment.port';
import { STAFF_DIRECTORY } from './application/ports/staff-directory.port';
import { ReassignReferrer } from './application/reassign-referrer.use-case';
import { ReferrerAdminActions } from './application/referrer-admin.use-cases';
import { SupportSessions } from './application/support-sessions.use-cases';
import { adminLogWriterProvider } from './infrastructure/backoffice/admin-log-writer.provider';
import { PrismaAccessEmailChanges } from './infrastructure/backoffice/prisma-access-email-changes';
import { PrismaAdminInsightsReader } from './infrastructure/backoffice/prisma-admin-insights.reader';
import { PrismaAdminPaymentsReader } from './infrastructure/backoffice/prisma-admin-payments.reader';
import { PrismaAdminReferrersReader } from './infrastructure/backoffice/prisma-admin-referrers.reader';
import { PrismaAdminSettingsStore } from './infrastructure/backoffice/prisma-admin-settings.store';
import { PrismaAdminWeddingsReader } from './infrastructure/backoffice/prisma-admin-weddings.reader';
import { PrismaGuestErasure } from './infrastructure/backoffice/prisma-guest-erasure';
import { PrismaReferrerAdminStore } from './infrastructure/backoffice/prisma-referrer-admin.store';
import { PrismaReferrerReassignment } from './infrastructure/backoffice/prisma-referrer-reassignment';
import { PrismaStaffDirectory } from './infrastructure/backoffice/prisma-staff-directory';
import { HmacSearchTermHasher } from './infrastructure/providers/hmac-search-term-hasher';
import { integrationProbesProvider } from './infrastructure/providers/integration-probes.provider';
import { AdminInsightsController } from './presentation/controllers/admin-insights.controller';
import { AdminPaymentsController } from './presentation/controllers/admin-payments.controller';
import { AdminPayoutsController } from './presentation/controllers/admin-payouts.controller';
import { AdminReferrersReadController } from './presentation/controllers/admin-referrers-read.controller';
import { AdminReferrersController } from './presentation/controllers/admin-referrers.controller';
import { AdminSettingsController } from './presentation/controllers/admin-settings.controller';
import { AdminWeddingsController } from './presentation/controllers/admin-weddings.controller';
import { SupportSessionsController } from './presentation/controllers/support-sessions.controller';
import { StaffGuard } from './presentation/http/guards/staff.guard';

/**
 * O Backoffice da equipe do Kore (/v1/admin; Backoffice - acesso), pela
 * conexão do backoffice (decisão 180(5)), atrás do StaffGuard.
 */
@Module({
  imports: [BillingModule, AccessModule],
  controllers: [
    AdminPaymentsController,
    AdminReferrersController,
    AdminPayoutsController,
    AdminWeddingsController,
    AdminInsightsController,
    SupportSessionsController,
    AdminReferrersReadController,
    AdminSettingsController,
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
    { provide: REFERRER_ADMIN_STORE, useClass: PrismaReferrerAdminStore },
    ReferrerAdminActions,
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
    { provide: ADMIN_REFERRERS_READER, useClass: PrismaAdminReferrersReader },
    AdminReferrers,
    { provide: ADMIN_SETTINGS_STORE, useClass: PrismaAdminSettingsStore },
    integrationProbesProvider,
    AdminSettings,
  ],
})
export class BackofficeModule {}
