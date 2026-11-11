import { cellText, exportFileName, orderedColumns, type ExportGuest } from './export';

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
