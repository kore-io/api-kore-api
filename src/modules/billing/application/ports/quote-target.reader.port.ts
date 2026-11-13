/** O casamento como a cotação o lê (Preço e cotação RN04), com a RLS do casamento. */
export interface QuoteTarget {
  status: string;
  slug: string | null;
  /** AAAA-MM-DD. */
  eventDate: string | null;
  timezone: string | null;
  endDate: string | null;
  paidThrough: string | null;
  publishedAt: Date | null;
  /** Bloqueado (403 WEDDING_BLOCKED) e exclusão agendada (409; Data de saída do ar RN10). */
  blockedAt?: Date | null;
  deletionScheduledFor?: Date | null;
  /** O indicador, quando o casamento tem um (RN01, passo 4). */
  referrer: {
    kind: 'planner' | 'seller';
    status: 'active' | 'blocked' | 'inactive';
    referralDiscountEnabled: boolean;
  } | null;
}

export interface QuoteTargetReader {
  read({ weddingId }: { weddingId: string }): Promise<QuoteTarget | null>;
  /** O percentual do desconto de indicação vigente (ReferralSettings; RN10). */
  referralDiscountPercent(): Promise<number>;
}

export const QUOTE_TARGET_READER = Symbol('QuoteTargetReader');
