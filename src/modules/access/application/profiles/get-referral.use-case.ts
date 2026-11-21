import { Inject, Injectable } from '@nestjs/common';
import {
  ReferralLookupRateLimitedError,
  ReferralNotFoundError,
} from '@/modules/access/domain/access.errors';
import { toReferral, type Referral } from '@/modules/access/domain/profiles/referral';
import {
  REFERRAL_DIRECTORY,
  type ReferralDirectory,
} from '@/modules/access/application/ports/referral-directory.port';
import { IpFailureLimit } from '@/shared/rate-limit/ip-failure-limit';
import {
  REFERRAL_LOOKUP_FAILURES_PER_MINUTE,
  REFERRAL_LOOKUP_THROTTLER,
} from '@/shared/rate-limit/rate-limits';

/**
 * Lê o indicador do link de indicação para o cadastro (GET /v1/referrals/{code}).
 * O limite `referral_lookup` (decisão 306(1)) conta só o REFERRAL_NOT_FOUND:
 * olhado antes de ler, incrementado depois, só na falha.
 */
@Injectable()
export class GetReferral {
  constructor(
    @Inject(REFERRAL_DIRECTORY) private readonly referrals: ReferralDirectory,
    private readonly failures: IpFailureLimit,
  ) {}

  async execute({ code, ip }: { code: string; ip: string }): Promise<Referral> {
    const limit = { throttler: REFERRAL_LOOKUP_THROTTLER, ip };
    if (await this.failures.isBlocked({ ...limit, limit: REFERRAL_LOOKUP_FAILURES_PER_MINUTE }))
      throw new ReferralLookupRateLimitedError();

    const referrer = await this.referrals.findByCode({ code });
    const referral =
      referrer &&
      toReferral({
        referrer,
        referralDiscountPercent: await this.referrals.referralDiscountPercent(),
      });
    if (!referral) {
      await this.failures.recordFailure(limit);
      throw new ReferralNotFoundError();
    }
    return referral;
  }
}
