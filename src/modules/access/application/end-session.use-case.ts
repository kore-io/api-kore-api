import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';
import {
  SUPPORT_SESSION_STORE,
  type SupportSessionStore,
} from './ports/support-session.store.port';

/** "Sair": encerra só a sessão deste aparelho (RN09 de Login). */
@Injectable()
export class EndSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SUPPORT_SESSION_STORE) private readonly support: SupportSessionStore,
  ) {}

  async execute({ sessionId, now }: { sessionId: string; now: Date }): Promise<void> {
    // O logout do staff encerra o Ver como o casal aberto (Backoffice - acesso RN08).
    await this.support.endForSession({ sessionId, now });
    await this.sessions.revoke({ sessionId, now });
  }
}
