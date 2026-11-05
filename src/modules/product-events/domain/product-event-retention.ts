import { monthsBefore } from '../../../shared/time/months-before';

/** Retenção dos eventos de produto: 18 meses, o ciclo sazonal (Parecer; decisão 135). */
export const PRODUCT_EVENT_RETENTION_MONTHS = 18;

export function productEventRetentionCutoff({ now }: { now: Date }): Date {
  return monthsBefore({ now, months: PRODUCT_EVENT_RETENTION_MONTHS });
}
