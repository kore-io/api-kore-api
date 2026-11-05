import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/shared/http/configure-app';

/**
 * Sobe a API inteira, com a mesma configuração HTTP do main. `override`
 * permite trocar um provider (ex.: simular o Redis fora do ar).
 */
export async function createTestApp({
  override,
}: {
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
} = {}): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (override ? override(builder) : builder).compile();
  const app = configureApp({ app: moduleRef.createNestApplication(), enableDocs: false });
  await app.init();
  return app;
}
