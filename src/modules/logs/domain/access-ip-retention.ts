import { monthsBefore } from '../../../shared/time/months-before';

/** Prazo de guarda do IP real (decisão 116; Marco Civil da Internet, art. 15). */
export const ACCESS_IP_RETENTION_MONTHS = 6;

/** Instante antes do qual o IP real já passou do prazo e deve ser apagado. */
export function accessIpRetentionCutoff({ now }: { now: Date }): Date {
  return monthsBefore({ now, months: ACCESS_IP_RETENTION_MONTHS });
}
