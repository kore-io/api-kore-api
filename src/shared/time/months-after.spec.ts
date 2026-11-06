import { monthsAfter } from './months-after';

describe('monthsAfter', () => {
  it('soma meses de calendário mantendo a hora', () => {
    expect(monthsAfter({ from: new Date('2026-05-10T12:00:00Z'), months: 6 })).toEqual(
      new Date('2026-11-10T12:00:00Z'),
    );
  });

  it('dia que não existe no mês de destino vira o último dia', () => {
    expect(monthsAfter({ from: new Date('2026-08-31T00:00:00Z'), months: 6 })).toEqual(
      new Date('2027-02-28T00:00:00Z'),
    );
  });
});
