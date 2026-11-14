/** Ver como o casal termina depois de 30 minutos sem requisição (Backoffice - acesso RN08). */
export const SUPPORT_IDLE_MS = 30 * 60_000;
/** E no teto de 2 horas (decisão 230, D20). */
export const SUPPORT_MAX_MS = 2 * 60 * 60_000;

export type SupportEndReason = 'exit' | 'idle' | 'max_duration' | 'logout';

export interface SupportSessionRecord {
  id: string;
  adminUserId: string;
  weddingId: string;
  startedAt: Date;
  lastSeenAt: Date;
  endedAt: Date | null;
}

/** O fim automático devido agora, ou nulo (RN08). */
export function supportSessionExpiry({
  session,
  now,
}: {
  session: SupportSessionRecord;
  now: Date;
}): 'idle' | 'max_duration' | null {
  if (now.getTime() - session.startedAt.getTime() >= SUPPORT_MAX_MS) return 'max_duration';
  if (now.getTime() - session.lastSeenAt.getTime() >= SUPPORT_IDLE_MS) return 'idle';
  return null;
}

/** Até quando a sessão vale sem nova requisição: o menor entre a ociosidade e o teto. */
export function supportSessionExpiresAt({ session }: { session: SupportSessionRecord }): Date {
  return new Date(
    Math.min(
      session.lastSeenAt.getTime() + SUPPORT_IDLE_MS,
      session.startedAt.getTime() + SUPPORT_MAX_MS,
    ),
  );
}

/** Escrita em nome do casal durante o Ver como o casal (403 SUPPORT_READ_ONLY). */
export class SupportReadOnlyError extends Error {
  override name = 'SupportReadOnlyError';
}

/** A sessão de suporte acabou sozinha (403 SUPPORT_SESSION_ENDED, com o motivo). */
export class SupportSessionEndedError extends Error {
  override name = 'SupportSessionEndedError';
  constructor(readonly reason: 'idle' | 'max_duration') {
    super();
  }
}
