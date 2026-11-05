/**
 * O mesmo instante `months` meses de calendário antes, em UTC. Quando o dia
 * não existe no mês de destino (31/08 → fevereiro), usa o último dia do mês,
 * para nunca apagar antes do prazo.
 */
export function monthsBefore({ now, months }: { now: Date; months: number }): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(now.getUTCMonth() - months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(now.getUTCDate(), lastDayOfTargetMonth));
  return cutoff;
}
