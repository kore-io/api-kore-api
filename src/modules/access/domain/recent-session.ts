import type { AuthenticatedSession } from './authenticated-session';

/** Sessão recente: autenticada há no máximo 10 minutos (Retenção e expurgo RN08; B5-6). */
export const RECENT_SESSION_MS = 10 * 60_000;

/** 403 REAUTH_REQUIRED (não 401, para o app não confundir com a sessão vencida). */
export class ReauthRequiredError extends Error {
  override name = 'ReauthRequiredError';
}

/**
 * Ações sensíveis (a chave Pix, a exclusão do casamento) exigem que a pessoa
 * tenha entrado há pouco: fora disso, ela entra de novo.
 */
export function requireRecentSession({
  session,
  now,
}: {
  session: Pick<AuthenticatedSession, 'authenticatedAt'>;
  now: Date;
}): void {
  if (now.getTime() - session.authenticatedAt.getTime() > RECENT_SESSION_MS)
    throw new ReauthRequiredError();
}
