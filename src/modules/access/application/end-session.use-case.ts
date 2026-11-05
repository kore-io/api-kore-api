import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';

/** "Sair": encerra só a sessão deste aparelho (RN09 de Login). */
@Injectable()
export class EndSession {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute({ sessionId, now }: { sessionId: string; now: Date }): Promise<void> {
    await this.sessions.revoke({ sessionId, now });
  }
}
