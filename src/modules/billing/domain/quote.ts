import { localDate } from '../../../shared/time/local-date';
import {
  BillingEndDateOutOfRangeError,
  BillingEventDateMissingError,
  BillingNotDraftError,
  BillingSlugMissingError,
  NotPublishedError,
} from './billing.errors';
import {
  addDays,
  addMonths,
  CURRENT_PRICE_TABLE,
  monthsCovered,
  type PaidPeriod,
  type PaymentKindForPrice,
  type PaymentMethodForPrice,
  priceQuote,
  type PriceLines,
  type PriceTable,
} from './pricing';

/** AAAA-MM-DD. */
type Day = string;

/** Os status de quem pode estender (Data de saída do ar RN04): já publicou e não foi apagado. */
const EXTENDABLE = new Set(['published', 'post_event', 'grace', 'expired']);

export interface QuoteWedding {
  status: string;
  slug: string | null;
  eventDate: Day | null;
  timezone: string | null;
  endDate: Day | null;
  paidThrough: Day | null;
  publishedAt: Date | null;
}

export type ReferralLabel = 'assessoria' | 'indicacao';

export interface BillingQuote {
  kind: PaymentKindForPrice;
  priceVersion: string;
  /** O início dos meses cobertos (RN02). */
  periodStart: Day;
  /** Nulo quando não há data possível (canExtend falso). */
  periodEnd: Day | null;
  endDateMin: Day | null;
  endDateMax: Day;
  canExtend: boolean;
  cannotExtendReason: 'END_DATE_LIMIT_REACHED' | null;
  referralLabel: ReferralLabel | null;
  /** As linhas do preço; nulas quando não dá para estender. */
  lines: PriceLines | null;
}

/**
 * O início dos meses cobertos e os limites da nova data (Preço e cotação RN02 e
 * RN03; decisões 38 e 39; B4-1):
 * - publicação: o dia da cotação no fuso do casamento, de rascunho, com
 *   endereço, data e fuso;
 * - extensão: a data de saída do ar atual (ou o paidThrough, se o casal
 *   antecipou), ou hoje no expirado; só de quem já publicou.
 * A nova data vai do dia seguinte ao casamento (e depois do início) até o
 * casamento + 12 meses.
 */
export function quoteWindow({
  wedding,
  kind,
  now,
  table = CURRENT_PRICE_TABLE,
}: {
  wedding: QuoteWedding;
  kind: PaymentKindForPrice;
  now: Date;
  table?: PriceTable;
}): { start: Day; endDateMin: Day | null; endDateMax: Day } {
  if (kind === 'publication') {
    if (wedding.status !== 'draft') throw new BillingNotDraftError();
    if (!wedding.slug) throw new BillingSlugMissingError();
  } else if (!wedding.publishedAt || !EXTENDABLE.has(wedding.status) || !wedding.endDate) {
    throw new NotPublishedError();
  }
  if (!wedding.eventDate || !wedding.timezone) throw new BillingEventDateMissingError();

  const today = localDate({ at: now, timezone: wedding.timezone });
  let start = today;
  if (kind === 'extension' && wedding.status !== 'expired') {
    const current = wedding.endDate ?? today;
    start = wedding.paidThrough && wedding.paidThrough > current ? wedding.paidThrough : current;
  }
  const endDateMax = addMonths({
    day: wedding.eventDate,
    months: table.endDateMaxMonthsAfterEvent,
  });
  const dayAfterWedding = addDays({ day: wedding.eventDate, days: 1 });
  const dayAfterStart = addDays({ day: start, days: 1 });
  const endDateMin = dayAfterStart > dayAfterWedding ? dayAfterStart : dayAfterWedding;
  return { start, endDateMin: endDateMin <= endDateMax ? endDateMin : null, endDateMax };
}

/**
 * A cotação do servidor (Preço e cotação RN04 e RN05): a única verdade do
 * preço; o pagamento a recalcula e compara o total.
 */
export function buildQuote({
  wedding,
  kind,
  endDate,
  method,
  installments,
  referral,
  paidHistory = [],
  now,
  table = CURRENT_PRICE_TABLE,
}: {
  wedding: QuoteWedding;
  kind: PaymentKindForPrice;
  endDate: Day | null;
  method: PaymentMethodForPrice;
  installments: number;
  /** O desconto de indicação que vale para o casamento (RN01, passo 4), ou nulo. */
  referral: { percent: number; label: ReferralLabel } | null;
  paidHistory?: readonly PaidPeriod[];
  now: Date;
  table?: PriceTable;
}): BillingQuote {
  const window = quoteWindow({ wedding, kind, now, table });
  const base = {
    kind,
    priceVersion: table.priceVersion,
    periodStart: window.start,
    endDateMin: window.endDateMin,
    endDateMax: window.endDateMax,
    referralLabel: kind === 'publication' ? (referral?.label ?? null) : null,
  };
  if (!window.endDateMin) {
    // Sem data possível: a extensão chegou ao limite (RN03; decisão 230, D6).
    if (kind === 'extension')
      return {
        ...base,
        periodEnd: null,
        canExtend: false,
        cannotExtendReason: 'END_DATE_LIMIT_REACHED',
        lines: null,
      };
    throw new BillingEndDateOutOfRangeError(null, window.endDateMax);
  }
  // Sem data, só os limites (a primeira abertura da tela).
  if (!endDate)
    return { ...base, periodEnd: null, canExtend: true, cannotExtendReason: null, lines: null };
  if (endDate < window.endDateMin || endDate > window.endDateMax)
    throw new BillingEndDateOutOfRangeError(window.endDateMin, window.endDateMax);

  const lines = priceQuote({
    table,
    kind,
    monthsCovered: monthsCovered({ start: window.start, endDate }),
    method,
    installments,
    referralDiscountPercent: kind === 'publication' ? (referral?.percent ?? null) : null,
    paidHistory,
  });
  return { ...base, periodEnd: endDate, canExtend: true, cannotExtendReason: null, lines };
}

/**
 * O desconto de indicação do casamento (Preço e cotação RN01, passo 4;
 * decisões 59, 122(7), 166 e 230 D15): com indicador que tem o desconto ligado
 * e não está inativo. O bloqueado mantém o desconto do casal já atribuído.
 */
export function referralDiscountFor({
  referrer,
  percent,
}: {
  referrer: {
    kind: 'planner' | 'seller';
    status: 'active' | 'blocked' | 'inactive';
    referralDiscountEnabled: boolean;
  } | null;
  percent: number;
}): { percent: number; label: ReferralLabel } | null {
  if (!referrer || !referrer.referralDiscountEnabled || referrer.status === 'inactive') return null;
  if (percent <= 0) return null;
  return { percent, label: referrer.kind === 'planner' ? 'assessoria' : 'indicacao' };
}
