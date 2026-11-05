import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { rateLimitTracker } from './rate-limit-tracker';

/**
 * Limite global simples por IP (ADR do rate limit): a chave é o IP e o nome do
 * limite, não a rota, então as rotas somam no mesmo contador.
 */
@Injectable()
export class KoreThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, unknown>): Promise<string> {
    return Promise.resolve(
      rateLimitTracker({ ip: typeof request.ip === 'string' ? request.ip : '' }),
    );
  }

  protected override generateKey(_: ExecutionContext, tracker: string, name: string): string {
    return `${name}:${tracker}`;
  }

  protected override throwThrottlingException(): Promise<void> {
    throw new HttpException(
      { statusCode: 429, error: 'TOO_MANY_REQUESTS', message: 'Too many requests.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
