import type { ExportGuest } from '../domain/export';
import { groupsOf, planPages, renderExportPdf, type PlannedBlock } from './pdfkit-export-renderer';

const guest = (party: string, name: string): ExportGuest => ({
  name,
  party,
  ageGroup: 'adult',
  dietaryRestriction: null,
  rsvpStatus: 'confirmed',
  phone: null,
  tags: [],
});
const group = (name: string, size: number) =>
  Array.from({ length: size }, (_, i) => guest(name, `${name} ${i}`));
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
});
