/**
 * Depois de o staff trocar o e-mail de acesso, a pessoa espera 48 h para
 * cadastrar ou trocar chave Pix e para remover membros (Backoffice - acesso
 * RN09; decisão 253(2)). A fonte é o `User.accessEmailChangedAt`; o Admin não fura.
 */
export const RECENT_ACCESS_CHANGE_MS = 48 * 60 * 60_000;

/** 409 RECENT_ACCESS_CHANGE, com o instante em que libera. */
export class RecentAccessChangeError extends Error {
  override name = 'RecentAccessChangeError';
  constructor(readonly availableAt: Date) {
    super();
  }
}

/** Lança se a troca do e-mail de acesso foi há menos de 48 h. */
export function requireNoRecentAccessChange({
  accessEmailChangedAt,
  now,
}: {
  accessEmailChangedAt: Date | null;
  now: Date;
}): void {
  if (!accessEmailChangedAt) return;
  const availableAt = new Date(accessEmailChangedAt.getTime() + RECENT_ACCESS_CHANGE_MS);
  if (availableAt.getTime() > now.getTime()) throw new RecentAccessChangeError(availableAt);
}
