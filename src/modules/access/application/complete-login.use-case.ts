import { Inject, Injectable } from '@nestjs/common';
import {
  ACCESS_IP_LOG_WRITER,
  type AccessIpLogWriter,
} from '../../logs/application/ports/access-ip-log-writer.port';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../../product-events/application/ports/product-event-recorder.port';
import { UserBlockedError } from '../domain/access.errors';
import type { AuthMethod } from '../domain/authenticated-session';
import { loginNextStep, type LoginNext, type LoginOrigin } from '../domain/login-next-step';
import { PROFILE_DIRECTORY, type ProfileDirectory } from './ports/profile-directory.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import { StartSession } from './start-session.use-case';

export interface CompletedLogin {
  user: { id: string; email: string; isNew: boolean };
  next: LoginNext;
  inviteToken?: string;
  session: { token: string; expiresAt: Date };
}

/**
 * Depois de o e-mail ser confirmado (código, botão ou Google): cria a conta se
 * não existir (RN06), recusa usuário bloqueado (RN11), abre a sessão (RN08),
 * guarda o IP real do login (decisão 116) e decide o próximo passo (RN06, RN14).
 */
@Injectable()
export class CompleteLogin {
  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PROFILE_DIRECTORY) private readonly profiles: ProfileDirectory,
    @Inject(ACCESS_IP_LOG_WRITER) private readonly ipLog: AccessIpLogWriter,
    @Inject(PRODUCT_EVENT_RECORDER) private readonly productEvents: ProductEventRecorder,
    private readonly startSession: StartSession,
  ) {}

  async execute({
    email,
    method,
    providerSubject,
    origin,
    originRef,
    ip,
    userAgent,
    now,
  }: {
    email: string;
    method: AuthMethod;
    providerSubject: string;
    origin: LoginOrigin;
    originRef: string | null;
    ip: string | null;
    userAgent?: string;
    now: Date;
  }): Promise<CompletedLogin> {
    const { account, created } = await this.accounts.createOrGet({ email });
    if (created) {
      await this.productEvents.record({
        event: { name: 'conta_criada', props: { origem: origin, metodo: method } },
        occurredAt: now,
      });
    }
    if (account.status === 'blocked') throw new UserBlockedError();

    await this.accounts.ensureIdentity({ userId: account.id, provider: method, providerSubject });
    await this.accounts.recordLogin({ userId: account.id, now });
    const session = await this.startSession.execute({
      userId: account.id,
      now,
      authMethod: method,
      userAgent,
    });
    if (ip) {
      await this.ipLog.record({
        entry: { action: 'login', ip, occurredAt: now, actorKind: 'user', actorUserId: account.id },
      });
    }

    const profiles = await this.profiles.listProfiles({ userId: account.id });
    return {
      user: { id: account.id, email: account.email, isNew: created },
      ...loginNextStep({ origin, originRef, profileCount: profiles.length }),
      session,
    };
  }
}
