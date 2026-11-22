/**
 * O mesmo instante `months` meses de calendário depois, em UTC. Quando o dia
 * não existe no mês de destino (31/08 → fevereiro), usa o último dia do mês.
 */
export function monthsAfter({ from, months }: { from: Date; months: number }): Date {
  const result = new Date(from);
  result.setUTCDate(1);
  result.setUTCMonth(from.getUTCMonth() + months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(from.getUTCDate(), lastDayOfTargetMonth));
  return result;
}
