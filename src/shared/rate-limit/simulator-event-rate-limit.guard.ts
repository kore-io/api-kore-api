import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  RATE_LIMIT_WINDOW_MS,
  SIMULATOR_EVENTS_PER_MINUTE,
  SIMULATOR_EVENT_THROTTLER,
} from './rate-limits';

/**
 * O limite `simulator_event` por IP, no mesmo contador do Redis do throttler
 * global (kore:<env>:rl:simulator_event:<ip>), com a mesma resposta: 429
 * RATE_LIMITED.
 */
@Injectable()
export class SimulatorEventRateLimitGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = context.switchToHttp().getRequest<Request>().ip ?? 'unknown';
    const { isBlocked } = await this.storage.increment(
      `${SIMULATOR_EVENT_THROTTLER}:${ip}`,
      RATE_LIMIT_WINDOW_MS,
      SIMULATOR_EVENTS_PER_MINUTE,
      0,
      SIMULATOR_EVENT_THROTTLER,
    );
    if (isBlocked)
      throw new HttpException(
        { statusCode: 429, error: 'RATE_LIMITED', message: 'Too many requests.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
