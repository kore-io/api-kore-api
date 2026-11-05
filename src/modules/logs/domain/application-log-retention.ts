import { monthsBefore } from '../../../shared/time/months-before';

/** Prazo de guarda do log da aplicação (decisão 137). */
export const APPLICATION_LOG_RETENTION_YEARS = 5;

/** Instante antes do qual o registro do log da aplicação deve ser apagado. */
export function applicationLogRetentionCutoff({ now }: { now: Date }): Date {
  return monthsBefore({ now, months: APPLICATION_LOG_RETENTION_YEARS * 12 });
}
