import { Module } from '@nestjs/common';
import { AccessWorkerModule } from './modules/access/access-worker.module';
import { GuestsWorkerModule } from './modules/guests/guests-worker.module';
import { LogsWorkerModule } from './modules/logs/logs-worker.module';
import { ProductEventsWorkerModule } from './modules/product-events/product-events-worker.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailWorkerModule } from './shared/email/email-worker.module';
import { JobsModule } from './shared/jobs/jobs.module';
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
    LogsWorkerModule,
    ProductEventsWorkerModule,
    AccessWorkerModule,
    GuestsWorkerModule,
  ],
})
export class WorkerModule {}
