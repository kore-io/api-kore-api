/** Casamento sem fuso: o de Brasília (Lixeira RN10; Publicação RN12). */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** O dia (AAAA-MM-DD) de um instante no fuso do casamento. */
export function localDate({ at, timezone }: { at: Date; timezone: string | null }): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Dias de calendário entre duas datas AAAA-MM-DD (to − from). */
export function daysBetween({ from, to }: { from: string; to: string }): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
