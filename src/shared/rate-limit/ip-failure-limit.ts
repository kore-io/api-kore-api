import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfigService } from '@/shared/config/app-config.service';
import { REDIS_CLIENT } from '@/shared/redis/redis.module';
import { RATE_LIMIT_WINDOW_MS } from './rate-limits';

/** O relógio do limite de falhas, trocado no teste para virar a janela sem esperar. */
export interface RateLimitClock {
  now(): Date;
}

export const RATE_LIMIT_CLOCK = Symbol('RateLimitClock');

export const systemRateLimitClock: RateLimitClock = { now: () => new Date() };

const logger = new Logger('IpFailureLimit');

/**
 * Limite por IP que conta só as falhas (decisão 306; no molde do `party_link`,
 * ADR-36): olhado antes de resolver e incrementado depois, só se falhou. A
 * janela é o minuto do relógio injetado (kore:<env>:rl:<limite>:ip:<ip>:<minuto>);
 * a chave vence com a janela. Com o Redis fora, o limite não barra (decisão 97).
 */
@Injectable()
export class IpFailureLimit {
  private readonly prefix: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RATE_LIMIT_CLOCK) private readonly clock: RateLimitClock,
    config: AppConfigService,
  ) {
    this.prefix = `kore:${config.get({ key: 'APP_ENV' })}:rl:`;
  }

  async isBlocked({
    throttler,
    limit,
    ip,
  }: {
    throttler: string;
    limit: number;
    ip: string;
  }): Promise<boolean> {
    try {
      const count = Number(await this.redis.get(this.key({ throttler, ip })));
      return count >= limit;
    } catch (error) {
      logger.warn(`Limite ${throttler} sem Redis: ${(error as Error).name}`);
      return false;
    }
  }

  async recordFailure({ throttler, ip }: { throttler: string; ip: string }): Promise<void> {
    try {
      const key = this.key({ throttler, ip });
      // Juntos e atômicos: sem prazo, a chave ficaria no Redis para sempre.
      await this.redis.multi().incr(key).pexpire(key, RATE_LIMIT_WINDOW_MS, 'NX').exec();
    } catch (error) {
      logger.warn(`Limite ${throttler} sem Redis: ${(error as Error).name}`);
    }
  }

  private key({ throttler, ip }: { throttler: string; ip: string }): string {
    const window = Math.floor(this.clock.now().getTime() / RATE_LIMIT_WINDOW_MS);
    return `${this.prefix}${throttler}:ip:${ip}:${window}`;
  }
}

/** O limite de falhas e o relógio, para o `providers` do módulo que usa. */
export const ipFailureLimitProviders = [
  IpFailureLimit,
  { provide: RATE_LIMIT_CLOCK, useValue: systemRateLimitClock },
];
