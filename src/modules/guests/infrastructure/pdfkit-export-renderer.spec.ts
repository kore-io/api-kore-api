import PDFDocument from 'pdfkit';
import type { ExportGuest } from '../domain/export';
import { groupsOf, planPages, renderExportPdf, type PlannedBlock } from './pdfkit-export-renderer';

const guest = (party: string, name: string, partyId = party): ExportGuest => ({
  name,
  partyId,
  party,
  ageGroup: 'adult',
  dietaryRestriction: null,
  rsvpStatus: 'confirmed',
  phone: null,
  tags: [],
});
const group = (name: string, size: number, partyId = name) =>
  Array.from({ length: size }, (_, i) => guest(name, `${name} ${i}`, partyId));
/** Em que páginas cada grupo aparece. */
const pagesOf = (blocks: PlannedBlock[]) => {
  const pages = new Map<string, Set<number>>();
  for (const block of blocks)
    if (block.kind === 'guest')
      pages.set(block.guest.party, (pages.get(block.guest.party) ?? new Set()).add(block.page));
  return Object.fromEntries([...pages].map(([name, set]) => [name, [...set]]));
};
// A tabela começa no mesmo ponto da primeira página do desenho (y 229).
const TABLE_TOP = 229;

describe('Paginação do PDF (Exportação RN01)', () => {
  it('RN01 - um grupo de até 10 pessoas que não cabe vai inteiro para a página seguinte', () => {
    // 25 linhas de 27 px ocupam a primeira página quase toda; o grupo de 10 não cabe.
    const blocks = planPages({
      groups: groupsOf([...group('A', 25), ...group('B', 10)]),
      tableTop: TABLE_TOP,
    });

    expect(pagesOf(blocks)).toEqual({ A: [0], B: [1] });
  });

  it('RN01 - um grupo maior que 10 começa onde estiver e quebra, repetindo o nome do grupo', () => {
    const blocks = planPages({
      groups: groupsOf([...group('A', 20), ...group('B', 15)]),
      tableTop: TABLE_TOP,
    });

    expect(pagesOf(blocks)).toEqual({ A: [0], B: [0, 1] });
    expect(
      blocks.filter((block) => block.kind === 'group' && block.name === 'B').map((b) => b.page),
    ).toEqual([0, 1]);
  });

  it('RN01 e decisão 184(12) - dois grupos com o mesmo nome, lado a lado, são dois blocos, cada um com a regra dos 10', () => {
    const groups = groupsOf([
      ...group('A', 20),
      ...group('Família Silva', 6, 'silva-1'),
      ...group('Família Silva', 6, 'silva-2'),
    ]);

    expect(groups.map(({ partyId, guests }) => [partyId, guests.length])).toEqual([
      ['A', 20],
      ['silva-1', 6],
      ['silva-2', 6],
    ]);
    // Juntos seriam 12 (mais de 10) e quebrariam no meio; separados, cada um fica inteiro.
    const blocks = planPages({ groups, tableTop: TABLE_TOP });
    const pagesOfParty = (partyId: string) => [
      ...new Set(
        blocks
          .filter((block) => block.kind === 'guest' && block.guest.partyId === partyId)
          .map((block) => block.page),
      ),
    ];
    expect(pagesOfParty('silva-1')).toHaveLength(1);
    expect(pagesOfParty('silva-2')).toHaveLength(1);
    expect(
      blocks.filter((block) => block.kind === 'group' && block.name === 'Família Silva'),
    ).toHaveLength(2);
  });

  it('RN01 - nenhuma linha passa do fim da área da tabela', () => {
    const blocks = planPages({
      groups: groupsOf(Array.from({ length: 30 }, (_, i) => group(`G${i}`, (i % 12) + 1)).flat()),
      tableTop: TABLE_TOP,
    });

    expect(blocks.every((block) => block.y <= 1007)).toBe(true);
  });
});

describe('PDF da exportação (Exportação RN01)', () => {
  it('RN01 - gera um PDF A4 com as fontes embutidas e uma página por bloco', async () => {
    const pdf = await renderExportPdf({
      guests: [...group('Família Moreira', 3), ...group('Zé Grande', 60)],
      columns: ['name', 'party', 'ageGroup', 'dietaryRestriction', 'rsvp', 'phone', 'tags'],
      heading: {
        title: 'Ana & Marcos',
        eventLine: 'Sábado, 14/11/2026 · Campinas (SP)',
        filter: 'Confirmados',
        summary: '63 convidados · 63 adultos',
        generated: 'Gerado pelo Kore em 06/11/2026',
      },
    });
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
    expect(raw).toMatch(/CormorantGaramond-SemiBold/);
    expect(raw).toMatch(/NunitoSans-Regular/);
    expect((raw.match(/\/Type \/Page\b/g) ?? []).length).toBe(3);
  });

  it('RN01 - o que o PDF escreve: o topo, o resumo, os títulos em cada página e "Página X de Y"', async () => {
    const write = jest.spyOn(PDFDocument.prototype, 'text');
    const heading = {
      title: 'Ana & Marcos',
      eventLine: 'Sábado, 14/11/2026 · Campinas (SP)',
      filter: 'Confirmados',
      summary: '63 convidados · 63 adultos',
      generated: 'Gerado pelo Kore em 06/11/2026',
    };
    try {
      await renderExportPdf({
        guests: [...group('Família Moreira', 3), ...group('Zé Grande', 60)],
        // Sem a coluna Grupo, o nome do grupo só aparece na faixa do grupo.
        columns: ['name', 'rsvp'],
        heading,
      });
      const texts = write.mock.calls.map(([value]) => String(value));

      for (const line of [heading.title, heading.eventLine, heading.filter, heading.summary])
        expect(texts).toContain(line);
      // Os títulos das colunas repetem em cada uma das 3 páginas.
      for (const title of ['NOME', 'RESPOSTA'])
        expect(texts.filter((value) => value === title)).toHaveLength(3);
      expect(texts.filter((value) => value === heading.generated)).toHaveLength(3);
      expect(texts.filter((value) => /^Página \d+ de \d+$/.test(value))).toEqual([
        'Página 1 de 3',
        'Página 2 de 3',
        'Página 3 de 3',
      ]);
      expect(texts.filter((value) => value === 'Família Moreira')).toHaveLength(1);
      // O grupo de 60 passa pelas 3 páginas e repete o nome do grupo em cada uma.
      expect(texts.filter((value) => value === 'Zé Grande')).toHaveLength(3);

      write.mockClear();
      await renderExportPdf({
        guests: group('Família Moreira', 3),
        columns: ['name'],
        heading: { ...heading, eventLine: '' },
      });
      expect(write.mock.calls.map(([value]) => String(value))).not.toContain(heading.eventLine);
    } finally {
      write.mockRestore();
    }
  });
});
