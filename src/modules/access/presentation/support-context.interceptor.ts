import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { SupportContext, type SupportScope } from '../../../shared/database/support-context';

/**
 * Põe o Ver como o casal (que o SupportSessionGuard conferiu) no contexto da
 * requisição inteira, antes da transação: a TenantTransaction e a autorização
 * o leem dali (Backoffice - acesso RN08).
 */
@Injectable()
export class SupportContextInterceptor implements NestInterceptor {
  constructor(private readonly support: SupportContext) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const scope = context.switchToHttp().getRequest<{ support?: SupportScope }>().support;
    if (!scope) return next.handle();
    return new Observable((subscriber) =>
      this.support.run(scope, () => next.handle().subscribe(subscriber)),
    );
  }
}
