import { Inject, Injectable } from '@nestjs/common';
import { renewedExpiry } from '../domain/session-lifetime';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';
import { SESSION_TOKENS, type SessionTokens } from './ports/session-token.port';

/**
 * Abre uma sessão para um usuário que acabou de entrar (código, botão de
 * acesso ou Google). Chamado pelos fluxos de login; devolve o token aberto,
 * que só existe no cookie.
 */
@Injectable()
export class StartSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokens,
  ) {}

  async execute({
    userId,
    now,
    userAgent,
  }: {
    userId: string;
    now: Date;
    userAgent?: string;
  }): Promise<{ token: string; expiresAt: Date }> {
    const { token, tokenHash } = this.tokens.generate();
    const expiresAt = renewedExpiry({ now });
    await this.sessions.create({ userId, tokenHash, now, expiresAt, userAgent });
    return { token, expiresAt };
  }
}
