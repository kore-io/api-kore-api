import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';
import { buildLoggerParams } from './logger.options';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerParams({
          appEnv: config.get({ key: 'APP_ENV' }),
          level: config.get({ key: 'LOG_LEVEL' }),
        }),
    }),
  ],
})
export class ObservabilityModule {}
