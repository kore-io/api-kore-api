import { INestApplication, Type } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { AppConfigService } from '../../src/shared/config/app-config.service';
import { configureApp } from '../../src/shared/http/configure-app';

/**
 * Sobe a API inteira, com a mesma configuração HTTP do main. `override`
 * permite trocar um provider (ex.: simular o Redis fora do ar), e
 * `controllers` acrescenta rotas só do teste.
 */
export async function createTestApp({
  override,
  controllers = [],
}: {
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  controllers?: Type[];
} = {}): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule], controllers });
  const moduleRef = await (override ? override(builder) : builder).compile();
  const app = configureApp({
    app: moduleRef.createNestApplication({ rawBody: true }),
    enableDocs: false,
    allowedOrigins: moduleRef.get(AppConfigService).get({ key: 'ALLOWED_ORIGINS' }),
    siteOrigin: moduleRef.get(AppConfigService).siteOrigin,
    trustProxyHops: moduleRef.get(AppConfigService).get({ key: 'TRUST_PROXY_HOPS' }),
  });
  await app.init();
  return app;
}
