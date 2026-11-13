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
  PLANNER_WEDDING_THROTTLER,
  PLANNER_WEDDINGS_PER_MINUTE,
  RATE_LIMIT_WINDOW_MS,
  SITE_IMAGE_PER_MINUTE,
  TAX_ID_PER_HOUR,
  TAX_ID_THROTTLER,
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
  /** A janela do limite; o padrão é o minuto dos outros limites. */
  protected readonly windowMs: number = RATE_LIMIT_WINDOW_MS;

  constructor(private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ auth?: { userId: string } }>();
    const userId = request.auth?.userId;
    // Sem sessão o SessionGuard já recusou; aqui não há o que contar.
    if (!userId) return true;
    const { isBlocked } = await this.storage.increment(
      `${this.throttler}:user:${userId}`,
      this.windowMs,
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

/** Novo casamento pela cerimonialista (Novo casamento RN04). */
@Injectable()
export class PlannerWeddingRateLimitGuard extends UserRateLimitGuard {
  protected readonly throttler = PLANNER_WEDDING_THROTTLER;
  protected readonly perMinute = PLANNER_WEDDINGS_PER_MINUTE;

  constructor(@InjectThrottlerStorage() storage: ThrottlerStorage) {
    super(storage);
  }
}

/**
 * O CPF ou CNPJ do indicador (Repasse RN02; B7-8; decisão 244(3)): a recusa
 * TAX_ID_IN_USE revela que um CPF é de indicador, então 5 por hora por usuário.
 */
@Injectable()
export class TaxIdRateLimitGuard extends UserRateLimitGuard {
  protected readonly throttler = TAX_ID_THROTTLER;
  protected readonly perMinute = TAX_ID_PER_HOUR;
  protected override readonly windowMs = 60 * 60_000;

  constructor(@InjectThrottlerStorage() storage: ThrottlerStorage) {
    super(storage);
  }
}
