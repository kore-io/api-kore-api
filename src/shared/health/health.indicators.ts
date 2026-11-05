import { Inject, Injectable, Logger } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const CHECK_TIMEOUT_MS = 1_000;

// O health check é público: a resposta diz só "unreachable", e o log leva só o
// tipo do erro (error.name), nunca a mensagem, que pode ter host ou credencial.
const UNREACHABLE = { message: 'unreachable' };

const logger = new Logger('Health');

function logFailure({ key, error }: { key: string; error: unknown }): void {
  const name = error instanceof Error ? error.name : 'UnknownError';
  logger.warn(`${key} indisponível no health check (${name})`);
}

@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthIndicatorService,
  ) {}

  async check({ key }: { key: string }) {
    const session = this.health.check(key);
    try {
      await withTimeout({ promise: this.prisma.$queryRaw`SELECT 1` });
      return session.up();
    } catch (error) {
      logFailure({ key, error });
      return session.down(UNREACHABLE);
    }
  }
}

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly health: HealthIndicatorService,
  ) {}

  async check({ key }: { key: string }) {
    const session = this.health.check(key);
    try {
      await withTimeout({ promise: this.redis.ping() });
      return session.up();
    } catch (error) {
      logFailure({ key, error });
      return session.down(UNREACHABLE);
    }
  }
}

async function withTimeout<T>({ promise }: { promise: Promise<T> }): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HealthCheckTimeoutError()), CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

class HealthCheckTimeoutError extends Error {
  override name = 'HealthCheckTimeoutError';
}
