import { ownerlessStep, promisedPurgeDate, purgeDateFor } from './ownerless-purge';

const lastActivityAt = new Date('2026-01-10T12:00:00Z');
const purgeDate = new Date('2026-07-10T12:00:00Z');
const day = 24 * 60 * 60 * 1000;

describe('Expurgo do casamento sem dono (RN13 de Convites; decisão 180)', () => {
  it('RN13 - a data do expurgo é 6 meses de calendário depois da última atividade', () => {
    expect(purgeDateFor({ lastActivityAt })).toEqual(purgeDate);
  });

  it('decisão 180 - o aviso sai a partir de 30 dias antes da data do expurgo, e não antes', () => {
    expect(
      ownerlessStep({
        lastActivityAt,
        noticeSentAt: null,
        now: new Date(purgeDate.getTime() - 31 * day),
      }),
    ).toBeNull();
    expect(
      ownerlessStep({
        lastActivityAt,
        noticeSentAt: null,
        now: new Date(purgeDate.getTime() - 30 * day),
      }),
    ).toBe('notice');
  });

  it('decisão 180 - sem aviso, passada a data, ainda é aviso, nunca expurgo direto', () => {
    expect(
      ownerlessStep({
        lastActivityAt,
        noticeSentAt: null,
        now: new Date(purgeDate.getTime() + 10 * day),
      }),
    ).toBe('notice');
  });

  it('decisão 180 - com o aviso no prazo, expurga na data', () => {
    const noticeSentAt = new Date(purgeDate.getTime() - 30 * day);
    expect(
      ownerlessStep({ lastActivityAt, noticeSentAt, now: new Date(purgeDate.getTime() - 1) }),
    ).toBeNull();
    expect(ownerlessStep({ lastActivityAt, noticeSentAt, now: purgeDate })).toBe('purge');
  });

  it('decisão 180 - com o aviso atrasado, espera os 30 dias prometidos no e-mail', () => {
    const noticeSentAt = new Date(purgeDate.getTime() + 5 * day);
    expect(
      ownerlessStep({
        lastActivityAt,
        noticeSentAt,
        now: new Date(purgeDate.getTime() + 20 * day),
      }),
    ).toBeNull();
    expect(
      ownerlessStep({
        lastActivityAt,
        noticeSentAt,
        now: new Date(purgeDate.getTime() + 35 * day),
      }),
    ).toBe('purge');
  });

  it('decisão 180 - o e-mail promete a data do expurgo, ou 30 dias depois do aviso atrasado', () => {
    const onTime = new Date(purgeDate.getTime() - 30 * day);
    expect(promisedPurgeDate({ lastActivityAt, now: onTime })).toEqual(purgeDate);
    const late = new Date(purgeDate.getTime() + 5 * day);
    expect(promisedPurgeDate({ lastActivityAt, now: late })).toEqual(
      new Date(late.getTime() + 30 * day),
    );
  });
});
