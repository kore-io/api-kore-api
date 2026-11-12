import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * Filas e rotinas agendadas com BullMQ, no mesmo Redis da API. O prefixo
 * separa os ambientes que dividem o Redis (local e test).
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: { url: config.get({ key: 'REDIS_URL' }) },
        prefix: `kore:${config.get({ key: 'APP_ENV' })}`,
      }),
    }),
  ],
})
export class JobsModule {}
