import {
  ReferralLookupRateLimitedError,
  ReferralNotFoundError,
} from '@/modules/access/domain/access.errors';
import type { ReferrerRecord } from '@/modules/access/domain/profiles/referral';
import { GetReferral } from './get-referral.use-case';
import type { ReferralDirectory } from '@/modules/access/application/ports/referral-directory.port';
import type { IpFailureLimit } from '@/shared/rate-limit/ip-failure-limit';

function getReferralWith({
  referrer,
  blocked = false,
}: {
  referrer: ReferrerRecord | null;
  blocked?: boolean;
}) {
  const directory: ReferralDirectory = {
    findByCode: jest.fn().mockResolvedValue(referrer),
    referralDiscountPercent: jest.fn().mockResolvedValue(10),
  };
  const failures = {
    isBlocked: jest.fn().mockResolvedValue(blocked),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  } as unknown as IpFailureLimit;
  return { useCase: new GetReferral(directory, failures), directory, failures };
}

describe('GetReferral (GET /v1/referrals/{code})', () => {
  it('RN08 - dado um código inexistente, então REFERRAL_NOT_FOUND', async () => {
    await expect(
      getReferralWith({ referrer: null }).useCase.execute({ code: 'x', ip: '10.0.0.1' }),
    ).rejects.toThrow(ReferralNotFoundError);
  });

  it('RN08 - dado o indicador inativo, então responde igual a código inexistente', async () => {
    const referrer: ReferrerRecord = {
      referrerId: 'r2',
      userId: 'u-lucas',
      referralCode: 'lucas',
      kind: 'seller',
      status: 'inactive',
      accountStatus: 'active',
      displayName: 'Lucas',
      referralDiscountEnabled: true,
    };
    await expect(
      getReferralWith({ referrer }).useCase.execute({ code: 'lucas', ip: '10.0.0.1' }),
    ).rejects.toThrow(ReferralNotFoundError);
  });

  it('RN09 - dado o indicador ativo, então devolve o desconto vigente das configurações', async () => {
    const referrer: ReferrerRecord = {
      referrerId: 'r2',
      userId: 'u-lucas',
      referralCode: 'lucas',
      kind: 'seller',
      status: 'active',
      accountStatus: 'active',
      displayName: 'Lucas Lima',
      referralDiscountEnabled: true,
    };
    await expect(
      getReferralWith({ referrer }).useCase.execute({ code: 'lucas', ip: '10.0.0.1' }),
    ).resolves.toEqual({
      code: 'lucas',
      referrerName: 'Lucas Lima',
      kind: 'seller',
      discountPercent: 10,
    });
  });

  it('decisão 306(1) - só o REFERRAL_NOT_FOUND conta no limite; bloqueado, 429 sem ler o código', async () => {
    const missing = getReferralWith({ referrer: null });
    await expect(missing.useCase.execute({ code: 'x', ip: '10.0.0.1' })).rejects.toThrow(
      ReferralNotFoundError,
    );
    expect(missing.failures.recordFailure).toHaveBeenCalledWith({
      throttler: 'referral_lookup',
      ip: '10.0.0.1',
    });

    const blocked = getReferralWith({ referrer: null, blocked: true });
    await expect(blocked.useCase.execute({ code: 'x', ip: '10.0.0.1' })).rejects.toThrow(
      ReferralLookupRateLimitedError,
    );
    expect(blocked.directory.findByCode).not.toHaveBeenCalled();
  });
});
