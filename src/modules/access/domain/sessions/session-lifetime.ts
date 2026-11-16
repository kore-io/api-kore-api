/** A sessão dura 7 dias a partir do último uso (RN08 de Login sem senha e sessão). */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Intervalo mínimo entre duas renovações gravadas no banco: renovar a cada
 * requisição seria uma escrita por chamada, e um minuto não muda a RN08.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

export interface SessionLifetime {
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export function isSessionActive({
  session,
  now,
}: {
  session: SessionLifetime;
  now: Date;
}): boolean {
  return session.revokedAt === null && session.expiresAt.getTime() > now.getTime();
}

/** Novo fim da sessão depois de um uso agora. */
export function renewedExpiry({ now }: { now: Date }): Date {
  return new Date(now.getTime() + SESSION_IDLE_TTL_MS);
}

export function shouldRenew({ session, now }: { session: SessionLifetime; now: Date }): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS;
}
