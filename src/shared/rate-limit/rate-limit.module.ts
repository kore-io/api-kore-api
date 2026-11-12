import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { KoreThrottlerGuard } from './kore-throttler.guard';
import {
  AUTH_THROTTLER,
  GENERAL_THROTTLER,
  isAuthRateLimited,
  RATE_LIMIT_WINDOW_MS,
} from './rate-limits';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/** Rate limit global por IP, com contador no Redis (ADR do rate limit). */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService, REDIS_CLIENT],
      useFactory: (config: AppConfigService, redis: Redis) => ({
        throttlers: [
          {
            name: GENERAL_THROTTLER,
            ttl: RATE_LIMIT_WINDOW_MS,
            limit: config.get({ key: 'RATE_LIMIT_GENERAL_PER_MINUTE' }),
          },
          {
            name: AUTH_THROTTLER,
            ttl: RATE_LIMIT_WINDOW_MS,
            limit: config.get({ key: 'RATE_LIMIT_AUTH_PER_MINUTE' }),
            skipIf: (context) => !isAuthRateLimited(context),
          },
        ],
        storage: new RedisThrottlerStorage(redis, `kore:${config.get({ key: 'APP_ENV' })}:rl:`),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: KoreThrottlerGuard }],
})
export class RateLimitModule {}
