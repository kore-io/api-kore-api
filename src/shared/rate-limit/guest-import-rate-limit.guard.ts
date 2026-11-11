import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { InjectThrottlerStorage, type ThrottlerStorage } from '@nestjs/throttler';
import {
  GUEST_IMPORT_PER_MINUTE,
  GUEST_IMPORT_THROTTLER,
  RATE_LIMIT_WINDOW_MS,
} from './rate-limits';

/**
 * O limite guest_import por usuário, no mesmo contador do Redis do throttler
 * global, com a mesma resposta: 429 RATE_LIMITED.
 */
@Injectable()
export class GuestImportRateLimitGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ auth?: { userId: string } }>();
    const userId = request.auth?.userId;
    // Sem sessão o SessionGuard já recusou; aqui não há o que contar.
    if (!userId) return true;
    const { isBlocked } = await this.storage.increment(
      `${GUEST_IMPORT_THROTTLER}:user:${userId}`,
      RATE_LIMIT_WINDOW_MS,
      GUEST_IMPORT_PER_MINUTE,
      0,
      GUEST_IMPORT_THROTTLER,
    );
    if (isBlocked)
      throw new HttpException(
        { statusCode: 429, error: 'RATE_LIMITED', message: 'Too many requests.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}
