import {
  cellText,
  eventLine,
  exportFileName,
  filterLabel,
  formatPhone,
  generatedLine,
  orderedColumns,
  summaryLine,
  type ExportGuest,
} from './export';

const pedro: ExportGuest = {
  name: 'Pedro Moreira',
  party: 'Família Moreira',
  ageGroup: 'child',
  dietaryRestriction: null,
  rsvpStatus: 'confirmed',
  phone: null,
  tags: ['Família da Ana', 'Pajens'],
};

describe('Exportação (RN04 e RN09)', () => {
  it('RN04 - as colunas saem na ordem do arquivo, sem repetir', () => {
    expect(orderedColumns({ columns: ['tags', 'name', 'rsvp', 'name'] })).toEqual([
      'name',
      'rsvp',
      'tags',
    ]);
  });

  it('RN04 - os rótulos de faixa etária e resposta, as tags juntas e o vazio quando não há', () => {
    expect(
      ['ageGroup', 'rsvp', 'tags', 'phone', 'dietaryRestriction'].map((column) =>
        cellText({ guest: pedro, column: column as never }),
      ),
    ).toEqual(['Criança', 'Confirmado', 'Família da Ana, Pajens', '', '']);
  });

  it('RN09 - o nome do arquivo leva a data de hoje no fuso do casamento', () => {
    expect(
      exportFileName({
        slug: 'ana-e-marcos',
        timezone: 'America/Sao_Paulo',
        now: new Date('2026-11-07T02:30:00Z'),
        format: 'xlsx',
      }),
    ).toBe('convidados-ana-e-marcos-2026-11-06.xlsx');
  });
});

describe('PDF da exportação (RN01)', () => {
  const sat = new Date('2026-11-14T00:00:00Z');

  it('RN01 - o subtítulo com data e cidade; sem uma delas, a parte some, sem o " · " sobrando (189(10))', () => {
    expect(eventLine({ eventDate: sat, city: 'Campinas', state: 'SP' })).toBe(
      'Sábado, 14/11/2026 · Campinas (SP)',
    );
    expect(eventLine({ eventDate: null, city: 'Campinas', state: 'SP' })).toBe('Campinas (SP)');
    expect(eventLine({ eventDate: sat, city: null, state: null })).toBe('Sábado, 14/11/2026');
    expect(eventLine({ eventDate: null, city: null, state: null })).toBe('');
  });

  it('RN01 - o filtro do topo', () => {
    expect(filterLabel({ who: 'confirmed' })).toBe('Confirmados');
    expect(filterLabel({ who: 'tag', tagName: 'Padrinhos' })).toBe('Tag: Padrinhos');
    expect(filterLabel({ who: 'all' })).toBe('Todos os convidados');
  });

  it('RN01 - o resumo com singular e sem a faixa que tem zero', () => {
    const guest = (ageGroup: ExportGuest['ageGroup']): ExportGuest => ({ ...pedro, ageGroup });
    expect(
      summaryLine({
        guests: [
          guest('adult'),
          guest('adult'),
          guest('child'),
          guest('baby'),
          guest(null),
          guest(null),
        ],
      }),
    ).toBe('6 convidados · 2 adultos · 1 criança · 1 bebê · 2 sem faixa etária');
    expect(summaryLine({ guests: [guest('adult')] })).toBe('1 convidado · 1 adulto');
  });

  it('RN01 e RN09 - o rodapé e o telefone formatado', () => {
    expect(generatedLine({ now: new Date('2026-11-07T02:30:00Z'), timezone: null })).toBe(
      'Gerado pelo Kore em 06/11/2026',
    );
    expect(formatPhone({ e164: '+5519998763310' })).toBe('(19) 99876-3310');
    expect(formatPhone({ e164: '+351912345678' })).toBe('+351 912 345 678');
  });
});
