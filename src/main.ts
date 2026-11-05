import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './shared/config/app-config.service';
import { configureApp } from './shared/http/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);
  configureApp({ app, enableDocs: !config.isProduction });
  await app.listen(config.get({ key: 'PORT' }));
}

void bootstrap();
