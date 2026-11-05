import type { ReferrerRecord } from '../../domain/referral';

/** Indicadores pelo código do link e o desconto vigente (ReferralSettings). */
export interface ReferralDirectory {
  findByCode({ code }: { code: string }): Promise<ReferrerRecord | null>;
  referralDiscountPercent(): Promise<number>;
}

export const REFERRAL_DIRECTORY = Symbol('ReferralDirectory');
