import { Module } from '@nestjs/common';
import { BillingWorkerModule } from './modules/billing/billing-worker.module';
import { AccessWorkerModule } from './modules/access/access-worker.module';
import { GuestsWorkerModule } from './modules/guests/guests-worker.module';
import { LogsWorkerModule } from './modules/logs/logs-worker.module';
import { ProductEventsWorkerModule } from './modules/product-events/product-events-worker.module';
import { SiteWorkerModule } from './modules/site/site-worker.module';
import { ReferralWorkerModule } from './modules/referral/referral-worker.module';
import { NotificationsWorkerModule } from './modules/notifications/notifications-worker.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailWorkerModule } from './shared/email/email-worker.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { StorageModule } from './shared/storage/storage.module';
import { ObservabilityModule } from './shared/observability/observability.module';

/** Processo das rotinas agendadas e filas, separado da API (decisão 135). */
@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    EmailWorkerModule,
    StorageModule,
    // A chave Pix do repasse é decifrada no job do Pix de saída (Repasse RN05).
    CryptoModule,
    LogsWorkerModule,
    ProductEventsWorkerModule,
    AccessWorkerModule,
    GuestsWorkerModule,
    SiteWorkerModule,
    NotificationsWorkerModule,
    BillingWorkerModule,
    ReferralWorkerModule,
  ],
})
export class WorkerModule {}
