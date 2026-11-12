import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { LOGIN_REQUEST_WINDOW_MS } from '../domain/login-challenge-rules';
import { ACCESS_CLEANUP, type AccessCleanup } from './ports/access-cleanup.port';

export const ACCESS_CLEANUP_PURGED_ACTION = 'access_cleanup.purged';

/**
 * Limpeza diária (ADR de sessão no servidor; decisão 139): apaga as sessões
 * que já não valem e os pedidos de login que já saíram da janela da RN04, sem
 * guardar (o pedido traz o
 * e-mail de quem pode não ter conta e o IP real). O rastro da execução fica no
 * log da aplicação (ADR de multi-tenant, item 5).
 */
@Injectable()
export class PurgeEndedAccess {
  constructor(
    @Inject(ACCESS_CLEANUP) private readonly cleanup: AccessCleanup,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({
    now,
  }: {
    now: Date;
  }): Promise<{ sessions: number; loginChallenges: number; coupleLinkTokens: number }> {
    const sessions = await this.cleanup.deleteEndedSessions({ now });
    const loginChallenges = await this.cleanup.deleteLoginChallengesCreatedBefore({
      createdBefore: new Date(now.getTime() - LOGIN_REQUEST_WINDOW_MS),
    });
    // N1(b), condição 2: o token cifrado do link vencido sai na limpeza diária.
    const coupleLinkTokens = await this.cleanup.clearExpiredCoupleLinkTokens({ now });
    await this.applicationLog.record({
      entry: {
        action: ACCESS_CLEANUP_PURGED_ACTION,
        actorKind: 'system',
        data: { sessions, loginChallenges, coupleLinkTokens, now: now.toISOString() },
      },
    });
    return { sessions, loginChallenges, coupleLinkTokens };
  }
}
