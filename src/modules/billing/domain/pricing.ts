import { monthsAfter } from '../../../shared/time/months-after';

/** AAAA-MM-DD. */
type Day = string;

/**
 * Os valores de uma versão de preço (Preço e cotação RN01 e RN10; decisões 111,
 * 122(3), 230 e 231). Ficam no código, não em tabela: preço novo é versão nova,
 * e um pagamento antigo nunca é recalculado.
 */
export interface PriceTable {
  priceVersion: string;
  activationCents: number;
  monthlyCents: number;
  /** Teto da publicação, sobre o preço de tabela. */
  capCents: number;
  pixDiscountPercent: number;
  /** Juros de 7x a 12x: base × interestBasisPoints / 10000 + interestFixedCents. */
  interestBasisPoints: number;
  interestFixedCents: number;
  interestFreeUpTo: number;
  maxInstallments: number;
  /** A confirmar no Asaas (decisão 231, B1-2). */
  minInstallmentCents: number;
  endDateMaxMonthsAfterEvent: number;
}

/** A versão vigente (padrões provisórios da 230: D4 e D5). */
export const PRICE_TABLE_2026_11: PriceTable = {
  priceVersion: '2026-11',
  activationCents: 14_900,
  monthlyCents: 2_900,
  capCents: 44_900,
  pixDiscountPercent: 3,
  interestBasisPoints: 399,
  interestFixedCents: 49,
  interestFreeUpTo: 6,
  maxInstallments: 12,
  minInstallmentCents: 500,
  endDateMaxMonthsAfterEvent: 12,
};

export const CURRENT_PRICE_TABLE = PRICE_TABLE_2026_11;

export type PaymentKindForPrice = 'publication' | 'extension';
export type PaymentMethodForPrice = 'pix' | 'card';

/** O que o casamento já pagou: a função recebe o histórico (D5), para o teto acumulado futuro. */
export interface PaidPeriod {
  kind: PaymentKindForPrice;
  monthsCovered: number;
  amountCents: number;
}

export interface PriceLines {
  priceVersion: string;
  monthsCovered: number;
  activationListCents: number;
  /** O preço de tabela de um mês. */
  monthlyListCents: number;
  listTotalCents: number;
  capDiscountCents: number;
  referralDiscountCents: number;
  pixDiscountCents: number;
  installmentInterestCents: number;
  totalCents: number;
  installments: number;
  installmentCents: number;
  /** A diferença de centavos fica na primeira parcela (B1-1). */
  firstInstallmentCents: number;
  maxInstallments: number;
  totalsByMethod: { pix: number; cardUpTo6: number; cardChosen: number };
}

/** Meio para cima, em inteiros: (valor × numerador + metade) div denominador. */
function roundedShare({
  value,
  numerator,
  denominator,
}: {
  value: number;
  numerator: number;
  denominator: number;
}): number {
  return Math.floor((value * numerator + Math.floor(denominator / 2)) / denominator);
}

export class InstallmentsOutOfRangeError extends Error {
  constructor(readonly maxInstallments: number) {
    super(`Parcelas fora de 1 a ${maxInstallments}.`);
    this.name = 'InstallmentsOutOfRangeError';
  }
}

/**
 * A fórmula (Preço e cotação RN01), em centavos inteiros, sem ponto flutuante:
 * 1. tabela = ativação (só na publicação) + mês × meses;
 * 2. teto (só na publicação): base = min(tabela, teto);
 * 3. desconto de indicação (só na publicação): (ativação × % + 50) div 100;
 * 4. desconto do Pix (publicação e extensão): (base × 3 + 50) div 100;
 * 5. juros de 7x a 12x: (base × 399 + 5000) div 10000 + 49; até 6x, zero.
 * Arredonda-se cada desconto e os juros, nunca o total, que é a soma das
 * linhas (D4). As parcelas somam o total, com a diferença na primeira (B1-1).
 * A extensão é sempre mês × meses, sem teto acumulado (D5); o histórico pago
 * entra para que uma regra futura seja só uma versão nova.
 */
export function priceQuote({
  table = CURRENT_PRICE_TABLE,
  kind,
  monthsCovered,
  method,
  installments,
  referralDiscountPercent,
  paidHistory = [],
}: {
  table?: PriceTable;
  kind: PaymentKindForPrice;
  monthsCovered: number;
  method: PaymentMethodForPrice;
  installments: number;
  /** Nulo sem indicador com desconto (RN01, passo 4). */
  referralDiscountPercent: number | null;
  paidHistory?: readonly PaidPeriod[];
}): PriceLines {
  if (!Number.isInteger(monthsCovered) || monthsCovered < 1)
    throw new Error('Meses cobertos inválidos.');
  // A versão 2026-11 não usa o histórico: a extensão não tem teto acumulado (D5).
  void paidHistory;
  const publication = kind === 'publication';
  const activationListCents = publication ? table.activationCents : 0;
  const listTotalCents = activationListCents + table.monthlyCents * monthsCovered;
  const capDiscountCents = publication ? Math.max(0, listTotalCents - table.capCents) : 0;
  const referralDiscountCents =
    publication && referralDiscountPercent
      ? roundedShare({
          value: activationListCents,
          numerator: referralDiscountPercent,
          denominator: 100,
        })
      : 0;
  // A base dos passos 4 e 5: tabela − teto − indicação.
  const base = listTotalCents - capDiscountCents - referralDiscountCents;
  const pixDiscount = roundedShare({
    value: base,
    numerator: table.pixDiscountPercent,
    denominator: 100,
  });
  const interestFor = (count: number): number =>
    count > table.interestFreeUpTo
      ? roundedShare({ value: base, numerator: table.interestBasisPoints, denominator: 10_000 }) +
        table.interestFixedCents
      : 0;
  const maxInstallments = Math.max(
    1,
    Math.min(table.maxInstallments, Math.floor(base / table.minInstallmentCents)),
  );

  const count = method === 'pix' ? 1 : installments;
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > maxInstallments ||
    (method === 'pix' && installments !== 1)
  )
    throw new InstallmentsOutOfRangeError(maxInstallments);

  const pixDiscountCents = method === 'pix' ? pixDiscount : 0;
  const installmentInterestCents = method === 'card' ? interestFor(count) : 0;
  const totalCents = base - pixDiscountCents + installmentInterestCents;
  const installmentCents = Math.floor(totalCents / count);
  return {
    priceVersion: table.priceVersion,
    monthsCovered,
    activationListCents,
    monthlyListCents: table.monthlyCents,
    listTotalCents,
    capDiscountCents,
    referralDiscountCents,
    pixDiscountCents,
    installmentInterestCents,
    totalCents,
    installments: count,
    installmentCents,
    firstInstallmentCents: installmentCents + (totalCents % count),
    maxInstallments,
    totalsByMethod: {
      pix: base - pixDiscount,
      cardUpTo6: base,
      cardChosen: base + interestFor(method === 'card' ? count : 1),
    },
  };
}

/** Somar dias a uma data AAAA-MM-DD. */
export function addDays({ day, days }: { day: Day; days: number }): Day {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** O mesmo dia `months` meses depois; sem o dia no mês, o último (Cortesia RN04). */
export function addMonths({ day, months }: { day: Day; months: number }): Day {
  return monthsAfter({ from: new Date(`${day}T00:00:00Z`), months })
    .toISOString()
    .slice(0, 10);
}

/**
 * Meses cobertos (Preço e cotação RN02; decisões 1 e 38): o mês incompleto
 * conta inteiro. É o menor n ≥ 1 com início + n meses ≥ data de saída do ar.
 */
export function monthsCovered({ start, endDate }: { start: Day; endDate: Day }): number {
  if (endDate <= start) throw new Error('A data de saída do ar precisa ser depois do início.');
  let months = 1;
  while (addMonths({ day: start, months }) < endDate) months++;
  return months;
}
