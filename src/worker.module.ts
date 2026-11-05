import { Module } from '@nestjs/common';
import { LogsWorkerModule } from './modules/logs/logs-worker.module';
import { ProductEventsWorkerModule } from './modules/product-events/product-events-worker.module';
import { AppConfigModule } from './shared/config/app-config.module';
import { DatabaseModule } from './shared/database/database.module';
import { EmailWorkerModule } from './shared/email/email-worker.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { ObservabilityModule } from './shared/observability/observability.module';

/** Processo das rotinas agendadas e filas, separado da API (decisão 135). */
@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    DatabaseModule,
    JobsModule,
    EmailWorkerModule,
    LogsWorkerModule,
    ProductEventsWorkerModule,
  ],
})
export class WorkerModule {}
