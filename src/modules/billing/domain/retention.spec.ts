import { retentionStep } from './retention';

const noon = (day: string) => new Date(`${day}T15:00:00Z`);
const expired = {
  status: 'expired',
  purgeAt: '2027-08-22',
  purgeNoticeSentAt: null,
  deletionScheduledFor: null,
  blocked: false,
};

describe('retentionStep (Retenção e expurgo RN02, RN03 e RN05)', () => {
  it('RN02 - o aviso sai a partir de 30 dias antes do purgeAt', () => {
    expect(retentionStep({ ...expired, today: '2027-07-22', now: noon('2027-07-22') })).toBeNull();
    expect(retentionStep({ ...expired, today: '2027-07-23', now: noon('2027-07-23') })).toEqual({
      kind: 'notice',
    });
  });

  it('RN03 - expurga depois do purgeAt com o aviso de 30 dias ou mais', () => {
    const noticed = { ...expired, purgeNoticeSentAt: noon('2027-07-23') };
    expect(retentionStep({ ...noticed, today: '2027-08-22', now: noon('2027-08-22') })).toBeNull();
    expect(retentionStep({ ...noticed, today: '2027-08-23', now: noon('2027-08-23') })).toEqual({
      kind: 'purge',
      reason: 'retention',
    });
  });

  it('RN02 - aviso que saiu atrasado: o expurgo espera os 30 dias do aviso', () => {
    const late = { ...expired, purgeNoticeSentAt: noon('2027-08-20') };
    expect(retentionStep({ ...late, today: '2027-09-01', now: noon('2027-09-01') })).toBeNull();
    expect(retentionStep({ ...late, today: '2027-09-19', now: noon('2027-09-19') })).toEqual({
      kind: 'purge',
      reason: 'retention',
    });
  });

  it('RN02 - sem aviso, sem expurgo: depois do purgeAt o passo é avisar', () => {
    expect(retentionStep({ ...expired, today: '2027-09-01', now: noon('2027-09-01') })).toEqual({
      kind: 'notice',
    });
  });

  it('RN03 - bloqueado: nem aviso, nem expurgo', () => {
    const blocked = { ...expired, blocked: true, deletionScheduledFor: '2027-08-01' };
    expect(retentionStep({ ...blocked, today: '2027-09-01', now: noon('2027-09-01') })).toBeNull();
  });

  it('RN05 - a exclusão agendada expurga no dia, sem o aviso de 30 dias, em qualquer status', () => {
    const scheduled = {
      ...expired,
      status: 'published',
      purgeAt: null,
      deletionScheduledFor: '2026-11-21',
    };
    expect(
      retentionStep({ ...scheduled, today: '2026-11-20', now: noon('2026-11-20') }),
    ).toBeNull();
    expect(retentionStep({ ...scheduled, today: '2026-11-21', now: noon('2026-11-21') })).toEqual({
      kind: 'purge',
      reason: 'owner_request',
    });
  });

  it('RN05 - com a exclusão agendada, o aviso da retenção para', () => {
    const scheduled = { ...expired, deletionScheduledFor: '2027-09-30' };
    expect(
      retentionStep({ ...scheduled, today: '2027-07-23', now: noon('2027-07-23') }),
    ).toBeNull();
  });
});
