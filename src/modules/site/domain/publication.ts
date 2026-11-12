import { monthsAfter } from '../../../shared/time/months-after';

/** AAAA-MM-DD. */
type Day = string;

const addDays = ({ day, days }: { day: Day; days: number }): Day =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Os limites da data de saída do ar (Publicação RN04; decisão 39): do dia
 * seguinte ao casamento até `eventDate + 12 meses`; quando o dia não existe no
 * mês de chegada, o último dia do mês (29/02 → 28/02). Sem data ou sem fuso
 * do casamento, não há publicação, e os limites são nulos (RN01 e RN04).
 */
export function endDateRange({
  eventDate,
  timezone,
}: {
  eventDate: Day | null;
  timezone: string | null;
}): { min: Day; max: Day } | null {
  if (!eventDate || !timezone) return null;
  return {
    min: addDays({ day: eventDate, days: 1 }),
    max: monthsAfter({ from: new Date(`${eventDate}T00:00:00Z`), months: 12 })
      .toISOString()
      .slice(0, 10),
  };
}

/** A data de saída do ar está dentro dos limites (RN04). */
export function isEndDateInRange({
  endDate,
  range,
}: {
  endDate: Day;
  range: { min: Day; max: Day };
}): boolean {
  return endDate >= range.min && endDate <= range.max;
}
