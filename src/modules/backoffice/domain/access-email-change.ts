import { localDate } from '../../../shared/time/local-date';

// Decisão 253(1): os limites da troca do e-mail de acesso, num lugar só.
/** Tentativas por atendente (suporte) por dia de Brasília, contando as recusadas por CHECKS_FAILED. */
export const STAFF_DAILY_ATTEMPTS = 5;
/** Conferências erradas por casamento que travam a troca, na janela abaixo. */
export const WEDDING_FAILED_CHECKS_LIMIT = 3;
export const FAILED_CHECKS_WINDOW_MS = 24 * 60 * 60_000;
/** O Admin libera a trava uma vez por casamento nesta janela. */
export const UNLOCK_INTERVAL_MS = 24 * 60 * 60_000;
/** A 2ª troca no mesmo User nesta janela é só do Admin. */
export const REPEAT_CHANGE_WINDOW_MS = 7 * 24 * 60 * 60_000;

const BRASILIA = 'America/Sao_Paulo';

/** O começo do dia de Brasília de `now` e o do dia seguinte (o `retryAt` do 429). */
export function brasiliaDay({ now }: { now: Date }): { start: Date; next: Date } {
  const today = localDate({ at: now, timezone: BRASILIA });
  // Brasília não tem horário de verão desde 2019: UTC−3 fixo.
  const start = new Date(`${today}T03:00:00Z`);
  return { start, next: new Date(start.getTime() + 24 * 60 * 60_000) };
}

/** "ana***@gmail.com" (Backoffice - acesso RN09, o aviso ao endereço antigo; a máscara da 244). */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 3)}***@${domain}`;
}

/** Os 4 dígitos que o casal informou, comparados só como dígitos. */
export function normalizeLast4(value: string): string {
  return value.replace(/\D/g, '');
}
