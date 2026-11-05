import { Global, Inject, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const CONNECT_WAIT_MS = 2_000;

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.get({ key: 'REDIS_URL' }), {
          // Comando com o Redis fora do ar falha na hora em vez de esperar na
          // fila: quem usa o Redis decide o que fazer (decisão 97, item 3).
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        // Sem um ouvinte de 'error', o ioredis derruba o processo.
        client.on('error', (error: Error) => logger.warn(`Redis indisponível: ${error.message}`));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // Espera a conexão na subida (até CONNECT_WAIT_MS) para o primeiro comando
  // não falhar à toa; com o Redis fora, a API sobe assim mesmo e o ioredis
  // segue tentando em segundo plano (decisão 97, item 3).
  async onModuleInit(): Promise<void> {
    const connected = this.redis.connect().then(
      () => true,
      () => false,
    );
    const waited = new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), CONNECT_WAIT_MS).unref();
    });
    if (!(await Promise.race([connected, waited]))) {
      this.logger.warn('API subiu sem Redis; reconexão em segundo plano.');
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
