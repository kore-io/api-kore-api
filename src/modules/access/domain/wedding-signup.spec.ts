import {
  BRAZILIAN_STATES,
  cleanText,
  isValidSlugFormat,
  slugAlternatives,
  timezoneForState,
} from './wedding-signup';

const firstAlternatives = (slug: string, eventDate: Date | null, count = 3) => {
  const alternatives: string[] = [];
  for (const candidate of slugAlternatives({ slug, eventDate })) {
    alternatives.push(candidate);
    if (alternatives.length === count) break;
  }
  return alternatives;
};

describe('Cadastro do casal: regras do casamento', () => {
  it.each([
    ['SP', 'America/Sao_Paulo'],
    ['MT', 'America/Cuiaba'],
    ['AM', 'America/Manaus'],
    ['AC', 'America/Rio_Branco'],
  ] as const)('RN03 - a UF %s define o fuso %s', (state, timezone) => {
    expect(timezoneForState({ state })).toBe(timezone);
  });

  it('RN03 - todas as 27 UFs têm fuso', () => {
    expect(BRAZILIAN_STATES).toHaveLength(27);
  });

  it.each(['ana-e-marcos', 'abc', 'a1-b2', 'x'.repeat(40)])(
    'RN04 - "%s" tem formato válido',
    (slug) => {
      expect(isValidSlugFormat({ slug })).toBe(true);
    },
  );

  it.each(['-ana--e-marcos', 'ab', 'x'.repeat(41), 'Ana-e-marcos', 'ana_e_marcos', 'ana-', 'ána'])(
    'RN04 - "%s" tem formato inválido',
    (slug) => {
      expect(isValidSlugFormat({ slug })).toBe(false);
    },
  );

  it('RN05 - com data, a primeira alternativa leva o ano; depois vêm os números', () => {
    expect(firstAlternatives('ana-e-marcos', new Date('2026-11-14T00:00:00Z'))).toEqual([
      'ana-e-marcos-2026',
      'ana-e-marcos-2',
      'ana-e-marcos-3',
    ]);
  });

  it('RN05 - sem data, as alternativas são numeradas', () => {
    expect(firstAlternatives('ana-e-marcos', null, 2)).toEqual([
      'ana-e-marcos-2',
      'ana-e-marcos-3',
    ]);
  });

  it('RN05 - a base é cortada para a alternativa caber em 40 caracteres, sem hífen sobrando', () => {
    const [alternative] = firstAlternatives(`${'a'.repeat(34)}-bcdef`, new Date('2026-01-01'), 1);

    expect(alternative).toBe(`${'a'.repeat(34)}-2026`);
    expect(isValidSlugFormat({ slug: alternative })).toBe(true);
  });

  it('nomes e cidade perdem os espaços sobrando (decisão 166)', () => {
    expect(cleanText({ value: '  Ana   Beatriz ' })).toBe('Ana Beatriz');
  });
});
