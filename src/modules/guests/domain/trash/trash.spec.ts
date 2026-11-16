import { isPurgeDue, purgeAt } from './trash';

describe('purgeAt (Lixeira RN10; decisão 186, item 15)', () => {
  it('RN10 - removido em 06/11, purgeAt 06/12', () => {
    expect(
      purgeAt({ deletedAt: new Date('2026-11-06T14:00:00Z'), timezone: 'America/Sao_Paulo' }),
    ).toBe('2026-12-06');
  });

  it('RN10 - às 23 h em São Paulo vale o dia de São Paulo, não o de UTC', () => {
    // 23h30 de 06/11 em Brasília já é 07/11 em UTC.
    expect(
      purgeAt({ deletedAt: new Date('2026-11-07T02:30:00Z'), timezone: 'America/Sao_Paulo' }),
    ).toBe('2026-12-06');
  });

  it('RN10 - sem fuso, vale o de Brasília; outro fuso, o dele', () => {
    const deletedAt = new Date('2026-11-07T02:30:00Z');
    expect(purgeAt({ deletedAt, timezone: null })).toBe('2026-12-06');
    expect(purgeAt({ deletedAt, timezone: 'America/Manaus' })).toBe('2026-12-06');
    expect(purgeAt({ deletedAt, timezone: 'Europe/Lisbon' })).toBe('2026-12-07');
  });

  it('RN10 - atravessa o mês e o ano', () => {
    expect(purgeAt({ deletedAt: new Date('2026-12-15T12:00:00Z'), timezone: null })).toBe(
      '2027-01-14',
    );
  });
});

describe('isPurgeDue (Lixeira RN10)', () => {
  const deletedAt = new Date('2026-11-06T14:00:00Z'); // purgeAt 06/12

  it('RN10 - no dia purgeAt ainda restaura; no dia seguinte, apaga', () => {
    expect(
      isPurgeDue({ deletedAt, timezone: null, now: new Date('2026-12-06T23:00:00-03:00') }),
    ).toBe(false);
    expect(
      isPurgeDue({ deletedAt, timezone: null, now: new Date('2026-12-07T00:30:00-03:00') }),
    ).toBe(true);
  });

  it('RN10 - a data é a do fuso do casamento: 02h de 07/12 em UTC ainda é 06/12 em Brasília', () => {
    expect(
      isPurgeDue({
        deletedAt,
        timezone: 'America/Sao_Paulo',
        now: new Date('2026-12-07T02:00:00Z'),
      }),
    ).toBe(false);
  });
});
