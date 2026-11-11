import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  PARTY_LINK_FAILURES_PER_MINUTE,
  PARTY_LINK_THROTTLER,
  RATE_LIMIT_WINDOW_MS,
} from './rate-limits';

const logger = new Logger('PartyLinkFailures');

/**
 * O limite `party_link` por IP, só nas falhas (Site público RN06): o contador
 * é olhado antes de resolver o token e incrementado depois, só se falhou. Com
 * o Redis fora, o limite não barra (como o throttler geral, decisão 97).
 */
@Injectable()
export class PartyLinkFailures {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async isBlocked({ ip }: { ip: string }): Promise<boolean> {
    try {
      const count = Number(await this.redis.get(this.key({ ip })));
      return count >= PARTY_LINK_FAILURES_PER_MINUTE;
    } catch (error) {
      logger.warn(`Limite party_link sem Redis: ${(error as Error).name}`);
      return false;
    }
  }

  async recordFailure({ ip }: { ip: string }): Promise<void> {
    try {
      const key = this.key({ ip });
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.pexpire(key, RATE_LIMIT_WINDOW_MS);
    } catch (error) {
      logger.warn(`Limite party_link sem Redis: ${(error as Error).name}`);
    }
  }

  private key({ ip }: { ip: string }): string {
    return `${PARTY_LINK_THROTTLER}:ip:${ip}`;
  }
}
