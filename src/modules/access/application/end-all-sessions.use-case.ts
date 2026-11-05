import { Inject, Injectable } from '@nestjs/common';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';

/** "Sair de todos os aparelhos": encerra todas as sessões, inclusive a atual (RN09). */
@Injectable()
export class EndAllSessions {
  constructor(@Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository) {}

  async execute({ userId, now }: { userId: string; now: Date }): Promise<void> {
    await this.sessions.revokeAllForUser({ userId, now });
  }
}
