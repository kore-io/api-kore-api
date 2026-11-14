import type { AuthMethod, ProfileKind } from '../../domain/authenticated-session';

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  authenticatedAt: Date;
  authMethod: AuthMethod;
  activeProfile: ProfileKind | null;
  staffDomain: string | null;
  supportSessionId: string | null;
  revokedAt: Date | null;
  userStatus: 'active' | 'blocked';
}

export interface SessionRepository {
  create({
    userId,
    tokenHash,
    now,
    expiresAt,
    authMethod,
    staffDomain,
    userAgent,
  }: {
    userId: string;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
    authMethod: AuthMethod;
    staffDomain: string | null;
    userAgent?: string;
  }): Promise<{ id: string }>;
  findByTokenHash({ tokenHash }: { tokenHash: string }): Promise<SessionRecord | null>;
  renew({
    sessionId,
    now,
    expiresAt,
  }: {
    sessionId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void>;
  revoke({ sessionId, now }: { sessionId: string; now: Date }): Promise<void>;
  revokeAllForUser({ userId, now }: { userId: string; now: Date }): Promise<void>;
  /**
   * Perfil ativo da sessão (RN14 e RN16 de Login). Na transação da requisição,
   * quando há uma: num erro da rota, a sessão não muda.
   */
  setActiveProfile({
    sessionId,
    userId,
    profile,
  }: {
    sessionId: string;
    userId: string;
    profile: ProfileKind;
  }): Promise<void>;
}

export const SESSION_REPOSITORY = Symbol('SessionRepository');
