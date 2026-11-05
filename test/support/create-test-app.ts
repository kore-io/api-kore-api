import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/shared/http/configure-app';

/** Sobe a API inteira, com a mesma configuração HTTP do main. */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp({ app: moduleRef.createNestApplication(), enableDocs: false });
  await app.init();
  return app;
}
