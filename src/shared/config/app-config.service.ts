import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Acesso tipado à configuração já validada. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>({ key }: { key: K }): Env[K] {
    return this.config.get(key, { infer: true });
  }

  /** A origem do site do casal (esquema, host e porta do SITE_URL; Site público RN07). */
  get siteOrigin(): string {
    return new URL(this.get({ key: 'SITE_URL' })).origin;
  }

  get isProduction(): boolean {
    return this.get({ key: 'APP_ENV' }) === 'production';
  }
}
