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
  PAYMENT_WEBHOOK_PER_MINUTE,
  PAYMENT_WEBHOOK_THROTTLER,
  RATE_LIMIT_WINDOW_MS,
} from './rate-limits';

/**
 * O limite `payment_webhook` por IP (Publicar e pagar RN09), no mesmo Redis do
 * throttler global (kore:<env>:rl:payment_webhook:<ip>), com a mesma resposta.
 */
@Injectable()
export class PaymentWebhookRateLimitGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ip = context.switchToHttp().getRequest<Request>().ip ?? 'unknown';
    const { isBlocked } = await this.storage.increment(
      `${PAYMENT_WEBHOOK_THROTTLER}:${ip}`,
      RATE_LIMIT_WINDOW_MS,
      PAYMENT_WEBHOOK_PER_MINUTE,
      0,
      PAYMENT_WEBHOOK_THROTTLER,
    );
    if (isBlocked)
      throw new HttpException(
        { statusCode: 429, error: 'RATE_LIMITED', message: 'Too many requests.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
