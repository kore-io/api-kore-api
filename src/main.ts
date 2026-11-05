import './instrumentation';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';
import { configureApp } from './shared/http/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  const config = app.get(AppConfigService);
  configureApp({
    app,
    enableDocs: !config.isProduction,
    allowedOrigins: config.get({ key: 'ALLOWED_ORIGINS' }),
  });
  await app.listen(config.get({ key: 'PORT' }));
}

void bootstrap();
