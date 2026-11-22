import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** A sessão de suporte da requisição (Ver como o casal; Backoffice - acesso RN08). */
export interface SupportScope {
  supportSessionId: string;
  weddingId: string;
  staffUserId: string;
}

/**
 * O "Ver como o casal" da requisição corrente, posto pelo interceptor depois do
 * guard da sessão de suporte. Com ele, a TenantTransaction entra no papel
 * kore_support no casamento da sessão, e a autorização trata o staff como a
 * colaboradora (só leitura; RN08).
 */
@Injectable()
export class SupportContext {
  private readonly storage = new AsyncLocalStorage<SupportScope>();

  run<T>(scope: SupportScope, work: () => T): T {
    return this.storage.run(scope, work);
  }

  current(): SupportScope | undefined {
    return this.storage.getStore();
  }

  /** A sessão de suporte deste casamento, se a requisição é dela. */
  forWedding(weddingId: string): SupportScope | undefined {
    const scope = this.current();
    return scope && scope.weddingId === weddingId ? scope : undefined;
  }
}
