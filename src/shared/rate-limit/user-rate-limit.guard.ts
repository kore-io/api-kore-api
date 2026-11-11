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
  SITE_IMAGE_PER_MINUTE,
  SITE_IMAGE_THROTTLER,
} from './rate-limits';

/**
 * Limite nomeado por usuário, no mesmo contador do Redis do throttler global,
 * com a mesma resposta: 429 RATE_LIMITED. O tracker é o userId da sessão; por
 * isso o limite é um guard da rota, que roda depois da sessão, e não um
 * throttler do guard global (que roda antes).
 */
abstract class UserRateLimitGuard implements CanActivate {
  protected abstract readonly throttler: string;
  protected abstract readonly perMinute: number;

  constructor(private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ auth?: { userId: string } }>();
    const userId = request.auth?.userId;
    // Sem sessão o SessionGuard já recusou; aqui não há o que contar.
    if (!userId) return true;
    const { isBlocked } = await this.storage.increment(
      `${this.throttler}:user:${userId}`,
      RATE_LIMIT_WINDOW_MS,
      this.perMinute,
      0,
      this.throttler,
    );
    if (isBlocked)
      throw new HttpException(
        { statusCode: 429, error: 'RATE_LIMITED', message: 'Too many requests.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    return true;
  }
}

/** Importação de convidados (decisões 186, item 16, e 189, item 3). */
@Injectable()
export class GuestImportRateLimitGuard extends UserRateLimitGuard {
  protected readonly throttler = GUEST_IMPORT_THROTTLER;
  protected readonly perMinute = GUEST_IMPORT_PER_MINUTE;

  constructor(@InjectThrottlerStorage() storage: ThrottlerStorage) {
    super(storage);
  }
}

/** Imagens do site (S4 RN07): somado entre a autorização e a confirmação. */
@Injectable()
export class SiteImageRateLimitGuard extends UserRateLimitGuard {
  protected readonly throttler = SITE_IMAGE_THROTTLER;
  protected readonly perMinute = SITE_IMAGE_PER_MINUTE;

  constructor(@InjectThrottlerStorage() storage: ThrottlerStorage) {
    super(storage);
  }
}
