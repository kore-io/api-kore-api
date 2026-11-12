import { Inject, Injectable } from '@nestjs/common';
import { ReferralNotFoundError } from '../domain/access.errors';
import { toReferral, type Referral } from '../domain/referral';
import { REFERRAL_DIRECTORY, type ReferralDirectory } from './ports/referral-directory.port';

/** Lê o indicador do link de indicação para o cadastro (GET /v1/referrals/{code}). */
@Injectable()
export class GetReferral {
  constructor(@Inject(REFERRAL_DIRECTORY) private readonly referrals: ReferralDirectory) {}

  async execute({ code }: { code: string }): Promise<Referral> {
    const referrer = await this.referrals.findByCode({ code });
    if (!referrer) throw new ReferralNotFoundError();
    const referral = toReferral({
      referrer,
      referralDiscountPercent: await this.referrals.referralDiscountPercent(),
    });
    if (!referral) throw new ReferralNotFoundError();
    return referral;
  }
}
