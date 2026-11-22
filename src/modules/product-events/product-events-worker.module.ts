import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from '@/shared/config/app-config.service';
import { LogsWorkerModule } from '@/modules/logs/logs-worker.module';
import { PRODUCT_EVENT_RETENTION } from './application/ports/product-event-retention.port';
import { PurgeExpiredProductEvents } from './application/purge-expired-product-events.use-case';
import { PrismaProductEventRetention } from './infrastructure/backoffice/prisma-product-event-retention';
import { WeddingPseudonymizer } from './infrastructure/providers/wedding-pseudonymizer';
import {
  PRODUCT_EVENT_RETENTION_QUEUE,
  ProductEventRetentionProcessor,
  ProductEventRetentionScheduler,
} from './infrastructure/jobs/product-event-retention.job';

/** Retenção de 18 meses dos eventos de produto, do lado do worker (decisão 135). */
@Module({
  imports: [
    BullModule.registerQueue({ name: PRODUCT_EVENT_RETENTION_QUEUE }),
    // O log da aplicação pela conexão do backoffice (registro da execução).
    LogsWorkerModule,
  ],
  providers: [
    { provide: PRODUCT_EVENT_RETENTION, useClass: PrismaProductEventRetention },
    // Para pular os eventos do casamento bloqueado (decisão 290(1)).
    {
      provide: WeddingPseudonymizer,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new WeddingPseudonymizer({ keyBase64: config.get({ key: 'PRODUCT_EVENT_KEY' }) }),
    },
    PurgeExpiredProductEvents,
    ProductEventRetentionProcessor,
    ProductEventRetentionScheduler,
  ],
})
export class ProductEventsWorkerModule {}
