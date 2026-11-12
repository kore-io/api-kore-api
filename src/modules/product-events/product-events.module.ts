import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../shared/config/app-config.service';
import { PRODUCT_EVENT_RECORDER } from './application/ports/product-event-recorder.port';
import { PrismaProductEventRecorder } from './infrastructure/prisma-product-event-recorder';
import { SimulatorEventRateLimitGuard } from '../../shared/rate-limit/simulator-event-rate-limit.guard';
import { SimulatorEventsController } from './presentation/simulator-events.controller';
import { WeddingPseudonymizer } from './infrastructure/wedding-pseudonymizer';

/**
 * Eventos de produto, do lado da API. Global: qualquer módulo registra pela
 * porta PRODUCT_EVENT_RECORDER. A retenção roda no worker.
 */
@Global()
@Module({
  controllers: [SimulatorEventsController],
  providers: [
    SimulatorEventRateLimitGuard,
    {
      provide: WeddingPseudonymizer,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new WeddingPseudonymizer({ keyBase64: config.get({ key: 'PRODUCT_EVENT_KEY' }) }),
    },
    { provide: PRODUCT_EVENT_RECORDER, useClass: PrismaProductEventRecorder },
  ],
  exports: [PRODUCT_EVENT_RECORDER],
})
export class ProductEventsModule {}
