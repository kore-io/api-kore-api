import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './shared/http/configure-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp({ app, enableDocs: true });
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
