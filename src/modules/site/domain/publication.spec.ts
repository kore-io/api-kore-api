import { endDateRange, isEndDateInRange } from './publication';

describe('Data de saída do ar (Publicação RN04)', () => {
  it('RN04 - vai do dia seguinte ao casamento até 12 meses depois dele', () => {
    expect(endDateRange({ eventDate: '2026-11-14', timezone: 'America/Sao_Paulo' })).toEqual({
      min: '2026-11-15',
      max: '2027-11-14',
    });
  });

  it('RN04 (R1-6) - casamento em 29/02: o limite é o último dia de fevereiro do ano seguinte', () => {
    expect(endDateRange({ eventDate: '2028-02-29', timezone: 'America/Sao_Paulo' })).toEqual({
      min: '2028-03-01',
      max: '2029-02-28',
    });
  });

  it('RN04 - o dia seguinte atravessa o mês e o ano', () => {
    expect(endDateRange({ eventDate: '2026-12-31', timezone: 'America/Manaus' })?.min).toBe(
      '2027-01-01',
    );
  });

  it('RN01 e RN04 - sem data ou sem fuso, não há limites', () => {
    expect(endDateRange({ eventDate: null, timezone: 'America/Sao_Paulo' })).toBeNull();
    expect(endDateRange({ eventDate: '2026-11-14', timezone: null })).toBeNull();
  });

  it('RN04 - as duas pontas valem; fora delas, não', () => {
    const range = { min: '2026-11-15', max: '2027-11-14' };
    expect(isEndDateInRange({ endDate: '2026-11-15', range })).toBe(true);
    expect(isEndDateInRange({ endDate: '2027-11-14', range })).toBe(true);
    expect(isEndDateInRange({ endDate: '2026-11-14', range })).toBe(false);
    expect(isEndDateInRange({ endDate: '2027-11-15', range })).toBe(false);
  });
});
