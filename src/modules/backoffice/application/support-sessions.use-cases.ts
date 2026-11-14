import { Inject, Injectable } from '@nestjs/common';
import {
  SUPPORT_SESSION_STORE,
  type SupportSessionStore,
} from '../../access/application/ports/support-session.store.port';
import {
  supportSessionExpiresAt,
  type SupportSessionRecord,
} from '../../access/domain/support-session';
import {
  AdminWeddingNotFoundError,
  NoOwnerError,
  SupportSessionNotFoundError,
} from '../domain/backoffice.errors';
import type { StaffMember } from '../domain/staff';

export interface StartedSupportSession {
  supportSessionId: string;
  weddingId: string;
  startedAt: Date;
  expiresAt: Date;
}

const started = (session: SupportSessionRecord): StartedSupportSession => ({
  supportSessionId: session.id,
  weddingId: session.weddingId,
  startedAt: session.startedAt,
  expiresAt: supportSessionExpiresAt({ session }),
});

/**
 * Ver como o casal (Backoffice - acesso RN08), Admin e suporte: abrir com o
 * motivo (só com dono ativo; o casamento bloqueado e em retenção também) e
 * sair. A sessão do staff passa a apontar para a de suporte; as leituras do
 * casal rodam no kore_support pelo SupportSessionGuard.
 */
@Injectable()
export class SupportSessions {
  constructor(@Inject(SUPPORT_SESSION_STORE) private readonly store: SupportSessionStore) {}

  async start({
    staff,
    sessionId,
    weddingId,
    reason,
    now,
  }: {
    staff: StaffMember;
    sessionId: string;
    weddingId: string;
    reason: string;
    now: Date;
  }): Promise<StartedSupportSession> {
    const owner = await this.store.hasActiveOwner({ weddingId });
    if (owner === null) throw new AdminWeddingNotFoundError();
    // "O casal ainda não aceitou o convite." (Rascunho sem dono, Aguardando o casal).
    if (!owner) throw new NoOwnerError();
    return started(
      await this.store.start({ sessionId, adminUserId: staff.userId, weddingId, reason, now }),
    );
  }

  async end({
    staff,
    supportSessionId,
    now,
  }: {
    staff: StaffMember;
    supportSessionId: string;
    now: Date;
  }): Promise<void> {
    const session = await this.store.find({ id: supportSessionId });
    if (!session || session.adminUserId !== staff.userId || session.endedAt)
      throw new SupportSessionNotFoundError();
    await this.store.end({ id: supportSessionId, reason: 'exit', now });
  }
}
