import { Controller, Get, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../http/public.decorator';
import { DatabaseHealthIndicator, RedisHealthIndicator } from './health.indicators';

// Rota de infraestrutura: fica fora do /v1 (decisão 97, item 2).
@ApiTags('health')
@Public()
// O host chama o health a cada poucos segundos: fora do rate limit.
@SkipThrottle({ general: true, auth: true })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /**
   * Só o Postgres decide o 503 (o host reinicia a API). O Redis aparece no
   * corpo, mas não derruba a API: sem ele, o rate limit deixa passar
   * (decisões 97, item 3, e 134).
   */
  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    const redis = await this.redis.check({ key: 'redis' });
    const redisPlacement = redis.redis.status === 'up' ? 'info' : 'error';
    try {
      const result = await this.health.check([() => this.database.check({ key: 'database' })]);
      return withRedis({ result, redis, redisPlacement });
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      const result = error.getResponse() as HealthCheckResult;
      throw new ServiceUnavailableException(withRedis({ result, redis, redisPlacement }));
    }
  }
}

function withRedis({
  result,
  redis,
  redisPlacement,
}: {
  result: HealthCheckResult;
  redis: HealthCheckResult['details'];
  redisPlacement: 'info' | 'error';
}): HealthCheckResult {
  return {
    ...result,
    info: { ...result.info, ...(redisPlacement === 'info' ? redis : {}) },
    error: { ...result.error, ...(redisPlacement === 'error' ? redis : {}) },
    details: { ...result.details, ...redis },
  };
}
