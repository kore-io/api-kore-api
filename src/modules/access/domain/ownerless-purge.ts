import { monthsAfter } from '../../../shared/time/months-after';

/** RN13 de Convites: 6 meses sem atividade, sem dono, e o casamento é excluído. */
export const OWNERLESS_PURGE_MONTHS = 6;
/** O aviso ao indicador sai 30 dias antes (decisão 180). */
export const PURGE_NOTICE_DAYS = 30;
const NOTICE_MS = PURGE_NOTICE_DAYS * 24 * 60 * 60 * 1000;

export function purgeDateFor({ lastActivityAt }: { lastActivityAt: Date }): Date {
  return monthsAfter({ from: lastActivityAt, months: OWNERLESS_PURGE_MONTHS });
}

export type OwnerlessStep = 'notice' | 'purge' | null;

/**
 * Decisão 180: o aviso sai a partir de 30 dias antes da data do expurgo; o
 * expurgo só acontece passada a data E com o aviso enviado há pelo menos 30
 * dias (se a rotina atrasar, vale o prazo prometido no e-mail).
 */
export function ownerlessStep({
  lastActivityAt,
  noticeSentAt,
  now,
}: {
  lastActivityAt: Date;
  noticeSentAt: Date | null;
  now: Date;
}): OwnerlessStep {
  const purgeDate = purgeDateFor({ lastActivityAt });
  if (!noticeSentAt) return now.getTime() >= purgeDate.getTime() - NOTICE_MS ? 'notice' : null;
  const noticeMatured = now.getTime() >= noticeSentAt.getTime() + NOTICE_MS;
  return now >= purgeDate && noticeMatured ? 'purge' : null;
}

/** A data que o e-mail promete: a do expurgo, ou 30 dias depois do aviso, a que vier depois. */
export function promisedPurgeDate({
  lastActivityAt,
  now,
}: {
  lastActivityAt: Date;
  now: Date;
}): Date {
  const purgeDate = purgeDateFor({ lastActivityAt });
  const earliest = new Date(now.getTime() + NOTICE_MS);
  return purgeDate > earliest ? purgeDate : earliest;
}
