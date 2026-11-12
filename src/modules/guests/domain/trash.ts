/** Os itens ficam 30 dias na lixeira (Lixeira RN08 e RN10). */
export const TRASH_RETENTION_DAYS = 30;
/** Casamento sem fuso: o de Brasília (RN10). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** O dia (YYYY-MM-DD) de um instante no fuso do casamento. */
export function localDate({ at, timezone }: { at: Date; timezone: string | null }): string {
  // en-CA formata como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * purgeAt (RN10; decisão 186, item 15): a data de deletedAt no fuso do
 * casamento mais 30 dias. O item ainda restaura no dia purgeAt; a rotina o
 * apaga quando hoje, no fuso do casamento, é maior que purgeAt.
 */
export function purgeAt({
  deletedAt,
  timezone,
}: {
  deletedAt: Date;
  timezone: string | null;
}): string {
  const [year, month, day] = localDate({ at: deletedAt, timezone }).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + TRASH_RETENTION_DAYS)).toISOString().slice(0, 10);
}

/**
 * O item já pode ser apagado de vez (RN10): hoje, no fuso do casamento, é
 * maior que purgeAt. No próprio dia purgeAt ele ainda restaura.
 */
export function isPurgeDue({
  deletedAt,
  timezone,
  now,
}: {
  deletedAt: Date;
  timezone: string | null;
  now: Date;
}): boolean {
  return localDate({ at: now, timezone }) > purgeAt({ deletedAt, timezone });
}
