import type { DueNotice } from '@/modules/billing/application/ports/wedding-lifecycle.port';
import { payloadOf } from './advance-wedding-lifecycle.use-case';

const now = new Date('2027-02-22T15:00:00Z');
const expired: DueNotice = {
  weddingId: '0190a1b2-0000-7000-8000-000000000001',
  notice: 'expired',
  endDate: '2027-02-14',
  graceUntil: '2027-02-21',
  expiredAt: '2027-02-22',
  paidThrough: '2027-02-14',
  purgeAt: '2027-08-22',
  eventDate: '2026-11-14',
  timezone: 'America/Sao_Paulo',
  daysLeft: -8,
};

describe('payloadOf (Data de saída do ar RN03)', () => {
  it('decisão 336(3) - o item do expirado leva o purgeAt ("Os dados ficam guardados até…")', () => {
    expect(payloadOf({ due: expired, renewUntil: '2027-11-14', paidAhead: null, now })).toEqual({
      kind: 'expired',
      expiredAt: '2027-02-22',
      renewUntil: '2027-11-14',
      paidThrough: null,
      purgeAt: '2027-08-22',
      at: now.toISOString(),
    });
  });

  it('decisão 336(3) - sem purgeAt no casamento, o item leva nulo', () => {
    expect(
      payloadOf({ due: { ...expired, purgeAt: null }, renewUntil: null, paidAhead: null, now }),
    ).toMatchObject({ kind: 'expired', purgeAt: null });
  });

  it('decisão 336(3) - os outros avisos não levam o purgeAt', () => {
    const soon = payloadOf({
      due: { ...expired, notice: 'end_date_in_7_days', daysLeft: 7 },
      renewUntil: null,
      paidAhead: null,
      now,
    });
    const grace = payloadOf({
      due: { ...expired, notice: 'grace_day_1' },
      renewUntil: null,
      paidAhead: null,
      now,
    });
    expect(soon).not.toHaveProperty('purgeAt');
    expect(grace).not.toHaveProperty('purgeAt');
  });
});
