import type { PayoutRow } from './ports/payout-store.port';
import type { AppConfigService } from '../../../shared/config/app-config.service';
import { PayoutsDisabledError } from '../domain/referral.errors';
import type { PayoutDataStore } from './ports/payout-data-store.port';
import type { PayoutStore } from './ports/payout-store.port';
import { nextRequestAt, PayoutsUseCases } from './payouts.use-cases';

const payout = (requestedAt: string, status: PayoutRow['status'] = 'requested'): PayoutRow => ({
  id: 'p',
  amountCents: 15_804,
  status,
  holdReason: null,
  pixKeyMasked: 'jul***@pradoassessoria.com.br',
  requestedAt: new Date(requestedAt),
  paidAt: null,
  rejectedAt: null,
  rejectReason: null,
});

describe('Um pedido a cada 30 dias (Repasse RN04; decisão 247(4))', () => {
  it('decisão 247(4) - o dia do último pedido em São Paulo + 30, às 00h de São Paulo', () => {
    // 26/09 às 23h30 em São Paulo (27/09 em UTC): conta o 26/09 → 26/10.
    expect(nextRequestAt({ payouts: [payout('2026-09-27T02:30:00Z')] })).toEqual(
      new Date('2026-10-26T03:00:00Z'),
    );
  });

  it('RN07 - o recusado não conta; sem pedido, nada', () => {
    expect(
      nextRequestAt({
        payouts: [
          payout('2026-09-26T12:00:00Z', 'rejected'),
          payout('2026-08-01T12:00:00Z', 'paid'),
        ],
      }),
    ).toEqual(new Date('2026-08-31T03:00:00Z'));
    expect(nextRequestAt({ payouts: [] })).toBeNull();
  });
});

describe('Os repasses desligados (Repasse RN01)', () => {
  it('RN01 - PAYOUTS_DISABLED, sem chegar ao banco; a lista diz payoutsEnabled false', async () => {
    const request = jest.fn();
    const store = {
      isPlanner: jest.fn().mockResolvedValue(true),
      request,
      list: jest.fn().mockResolvedValue([]),
      minimumCents: jest.fn().mockResolvedValue(5_000),
    } satisfies PayoutStore;
    const payouts = new PayoutsUseCases(
      store,
      { listPixKeys: jest.fn().mockResolvedValue([]) } as unknown as PayoutDataStore,
      { record: jest.fn() },
      { get: () => false } as unknown as AppConfigService,
    );

    await expect(
      payouts.request({
        userId: 'u-j',
        idempotencyKey: 'k',
        expectedAmountCents: 15_804,
        now: new Date(),
      }),
    ).rejects.toThrow(PayoutsDisabledError);
    expect(request).not.toHaveBeenCalled();
    expect((await payouts.list({ userId: 'u-j', now: new Date() })).payoutsEnabled).toBe(false);
  });
});
