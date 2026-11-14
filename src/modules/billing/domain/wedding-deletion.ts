import { addDays } from './pricing';

/** O expurgo da exclusão pedida pelo casal fica para 7 dias depois (Retenção RN05; decisão 230, D14). */
export const DELETION_DAYS = 7;

/** O dia do expurgo: hoje, no fuso do casamento, mais 7 dias (AAAA-MM-DD). */
export function deletionDayFor({ today }: { today: string }): string {
  return addDays({ day: today, days: DELETION_DAYS });
}

const normalized = (value: string) =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

/**
 * "Digitem Ana & Marcos para confirmar" (RN05): o nome do casal como o app
 * mostra (os primeiros nomes com " & ", decisão 163). Os espaços a mais e as
 * maiúsculas não contam; os acentos contam.
 */
export function confirmNameMatches({
  confirmName,
  weddingName,
}: {
  confirmName: string;
  weddingName: string;
}): boolean {
  return normalized(confirmName) === normalized(weddingName);
}
