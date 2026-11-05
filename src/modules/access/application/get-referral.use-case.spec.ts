import { ReferralNotFoundError } from '../domain/access.errors';
import type { ReferrerRecord } from '../domain/referral';
import { GetReferral } from './get-referral.use-case';
import type { ReferralDirectory } from './ports/referral-directory.port';

function getReferralWith({ referrer }: { referrer: ReferrerRecord | null }) {
  const directory: ReferralDirectory = {
    findByCode: jest.fn().mockResolvedValue(referrer),
    referralDiscountPercent: jest.fn().mockResolvedValue(10),
  };
  return new GetReferral(directory);
}

describe('GetReferral (GET /v1/referrals/{code})', () => {
  it('RN08 - dado um código inexistente, então REFERRAL_NOT_FOUND', async () => {
    await expect(getReferralWith({ referrer: null }).execute({ code: 'x' })).rejects.toThrow(
      ReferralNotFoundError,
    );
  });

  it('RN08 - dado o indicador inativo, então responde igual a código inexistente', async () => {
    const referrer: ReferrerRecord = {
      referralCode: 'lucas',
      kind: 'seller',
      status: 'inactive',
      accountStatus: 'active',
      displayName: 'Lucas',
      referralDiscountEnabled: true,
    };
    await expect(getReferralWith({ referrer }).execute({ code: 'lucas' })).rejects.toThrow(
      ReferralNotFoundError,
    );
  });

  it('RN09 - dado o indicador ativo, então devolve o desconto vigente das configurações', async () => {
    const referrer: ReferrerRecord = {
      referralCode: 'lucas',
      kind: 'seller',
      status: 'active',
      accountStatus: 'active',
      displayName: 'Lucas Lima',
      referralDiscountEnabled: true,
    };
    await expect(getReferralWith({ referrer }).execute({ code: 'lucas' })).resolves.toEqual({
      code: 'lucas',
      referrerName: 'Lucas Lima',
      kind: 'seller',
      discountPercent: 10,
    });
  });
});
