import { Inject, Injectable } from '@nestjs/common';
import { SessionExpiredError } from '../domain/access.errors';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import { isSessionActive, renewedExpiry, shouldRenew } from '../domain/session-lifetime';
import { SESSION_REPOSITORY, type SessionRepository } from './ports/session-repository.port';
import { SESSION_TOKENS, type SessionTokens } from './ports/session-token.port';

/**
 * Valida o token do cookie e renova a sessão com o uso (RN08). Sessão
 * vencida ou encerrada: SessionExpiredError (RN10). Usuário bloqueado: as
 * sessões dele não valem (RN11); se uma ainda estiver aberta, é encerrada aqui
 * e a resposta é a mesma de sessão encerrada.
 */
@Injectable()
export class AuthenticateSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(SESSION_TOKENS) private readonly tokens: SessionTokens,
  ) {}

  async execute({
    token,
    now,
  }: {
    token: string | undefined;
    now: Date;
  }): Promise<{ session: AuthenticatedSession; renewedUntil: Date | null }> {
    if (!token) throw new SessionExpiredError();
    const record = await this.sessions.findByTokenHash({ tokenHash: this.tokens.hash({ token }) });
    if (!record || !isSessionActive({ session: record, now })) throw new SessionExpiredError();
    if (record.userStatus === 'blocked') {
      await this.sessions.revoke({ sessionId: record.id, now });
      throw new SessionExpiredError();
    }

    let renewedUntil: Date | null = null;
    if (shouldRenew({ session: record, now })) {
      renewedUntil = renewedExpiry({ now });
      await this.sessions.renew({ sessionId: record.id, now, expiresAt: renewedUntil });
    }

    return {
      session: {
        sessionId: record.id,
        userId: record.userId,
        authenticatedAt: record.authenticatedAt,
        authMethod: record.authMethod,
        activeProfile: record.activeProfile,
        staffDomain: record.staffDomain,
        supportSessionId: record.supportSessionId,
      },
      renewedUntil,
    };
  }
}
