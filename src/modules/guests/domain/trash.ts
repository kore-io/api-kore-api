import { DEFAULT_TIMEZONE, localDate } from '../../../shared/time/local-date';

export { DEFAULT_TIMEZONE, localDate };

/** Os itens ficam 30 dias na lixeira (Lixeira RN08 e RN10). */
export const TRASH_RETENTION_DAYS = 30;
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
