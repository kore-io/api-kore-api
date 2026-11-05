/** Prazo de guarda do IP real (decisão 116; Marco Civil da Internet, art. 15). */
export const ACCESS_IP_RETENTION_MONTHS = 6;

/**
 * Instante antes do qual o IP real já passou do prazo e deve ser apagado.
 * Meses de calendário em UTC; quando o dia não existe no mês de destino
 * (31/08 → fevereiro), usa o último dia do mês, para nunca apagar antes do prazo.
 */
export function accessIpRetentionCutoff({ now }: { now: Date }): Date {
  const cutoff = new Date(now);
  const targetMonth = now.getUTCMonth() - ACCESS_IP_RETENTION_MONTHS;
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(targetMonth);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(now.getUTCDate(), lastDayOfTargetMonth));
  return cutoff;
}
