import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

// Janela fixa: o primeiro acesso cria a chave com o prazo da janela; os
// seguintes só somam. Atômico no Redis, vale com várias instâncias da API.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { hits, redis.call('PTTL', KEYS[1]) }
`;

const WARN_INTERVAL_MS = 60_000;

/**
 * Contador do rate limit no Redis. Com o Redis fora do ar, deixa a requisição
 * passar e avisa no log (decisão 97, item 3): o login continua protegido pelos
 * limites gravados no banco.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private lastWarnAt = 0;

  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
  ) {}

  async increment(key: string, ttl: number, limit: number): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, pttl] = (await this.redis.eval(
        INCREMENT_SCRIPT,
        1,
        `${this.keyPrefix}${key}`,
        ttl,
      )) as [number, number];
      const secondsLeft = Math.max(0, Math.ceil(pttl / 1000));
      return {
        totalHits: hits,
        timeToExpire: secondsLeft,
        isBlocked: hits > limit,
        timeToBlockExpire: hits > limit ? secondsLeft : 0,
      };
    } catch (error) {
      this.warnFailOpen({ error });
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }

  // Um aviso por minuto, para o Redis fora não inundar o log.
  private warnFailOpen({ error }: { error: unknown }): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(`Rate limit sem Redis, requisições liberadas (${name}).`);
  }
}
