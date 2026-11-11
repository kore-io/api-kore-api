import {
  checkSpreadsheet,
  matchesTemplate,
  type CellValue,
  type SpreadsheetCheck,
} from './spreadsheet-import';

const header = [
  'Grupo',
  'Nome',
  'Telefone',
  'E-mail',
  'Faixa etária',
  'Restrição alimentar',
  'Tags',
];
type Row = [CellValue?, CellValue?, CellValue?, CellValue?, CellValue?, CellValue?, CellValue?];
const row = (...cells: Row): CellValue[] => Array.from({ length: 7 }, (_, i) => cells[i] ?? null);

function check(
  rows: CellValue[][],
  { parties = [], tags = [] }: { parties?: string[]; tags?: string[] } = {},
): SpreadsheetCheck {
  const result = checkSpreadsheet({
    rows,
    firstRow: 2,
    activePartyNames: parties,
    activeTagNames: tags,
  });
  if (typeof result === 'string') throw new Error(result);
  return result;
}

describe('Títulos do modelo (Importação RN03)', () => {
  it('RN03 - compara sem maiúsculas, acentos e espaços nas pontas, nessa ordem; colunas a mais à direita valem', () => {
    expect(matchesTemplate({ header })).toBe(true);
    expect(
      matchesTemplate({
        header: [
          ' grupo',
          'NOME',
          'telefone',
          'e-mail',
          'FAIXA ETARIA',
          'restricao alimentar',
          'Tags ',
          'Extra',
        ],
      }),
    ).toBe(true);
    expect(matchesTemplate({ header: ['Nome', 'Grupo', ...header.slice(2)] })).toBe(false);
    expect(matchesTemplate({ header: header.slice(0, 6) })).toBe(false);
  });
});

describe('Validação da planilha (Importação RN04 a RN08)', () => {
  it('RN04 - linhas do mesmo grupo (sem maiúsculas, acentos e espaços) formam um grupo com o texto da primeira; o contato é o primeiro com telefone ou e-mail', () => {
    const result = check([
      row('Família Moreira', 'Luiz Moreira'),
      row('familia  moreira', 'Célia Moreira', '19998763310'),
      row(),
      row('Vó Helena', 'Helena Moreira'),
    ]);

    expect(result.parties).toMatchObject([
      {
        name: 'Família Moreira',
        contactIndex: 1,
        guests: [{ row: 2 }, { row: 3, phone: '+5519998763310' }],
      },
      { name: 'Vó Helena', contactIndex: null, guests: [{ row: 5 }] },
    ]);
    expect(result.counts).toEqual({ valid: 3, errors: 0, duplicates: 0 });
  });

  it('RN05 - todas as falhas da linha aparecem, e counts.errors conta linhas', () => {
    const result = check([
      row(
        null,
        null,
        '9876-1402',
        'nao-e-email',
        'Idoso',
        'x'.repeat(201),
        `Ok, ${'t'.repeat(41)}`,
      ),
      row('Família', 'a'.repeat(81)),
    ]);

    expect(
      result.skipped.map((item) => [item.row, item.code, 'field' in item ? item.field : null]),
    ).toEqual([
      [2, 'NAME_MISSING', 'name'],
      [2, 'PARTY_MISSING', 'party'],
      [2, 'PHONE_TOO_SHORT', 'phone'],
      [2, 'EMAIL_INVALID', 'email'],
      [2, 'AGE_GROUP_INVALID', 'ageGroup'],
      [2, 'TOO_LONG', 'dietaryRestriction'],
      [2, 'TOO_LONG', 'tags'],
      [3, 'TOO_LONG', 'name'],
    ]);
    expect(result.skipped[2]).toMatchObject({ params: { n: 8 } });
    expect(result.skipped[6]).toMatchObject({ params: { tag: 't'.repeat(41) } });
    expect(result.counts).toEqual({ valid: 0, errors: 2, duplicates: 0 });
  });

  it('RN05 - o telefone pela célula número (sem o zero e sem o "+"), e a faixa etária sem maiúsculas, acentos e gênero', () => {
    const result = check([
      row('A', 'Ana', 19998763310, 'Ana@Gmail.com', 'ADULTA'),
      row('A', 'Bia', 5519998761402, null, 'crianca'),
      row('A', 'Caio', null, null, 'Bebê'),
    ]);

    expect(result.parties[0].guests).toMatchObject([
      { phone: '+5519998763310', email: 'ana@gmail.com', ageGroup: 'adult' },
      { phone: '+5519998761402', ageGroup: 'child' },
      { ageGroup: 'baby' },
    ]);
  });

  it('RN06 - a segunda linha com o mesmo nome no mesmo grupo fica de fora, apontando a primeira', () => {
    const result = check([
      row('Família Moreira', 'Pedro Moreira'),
      row('Outro', 'Pedro Moreira'),
      row('FAMÍLIA MOREIRA', ' pedro  moreira '),
    ]);

    expect(result.skipped).toEqual([
      {
        row: 4,
        name: 'pedro  moreira',
        kind: 'duplicate',
        code: 'DUPLICATE',
        duplicateOf: { row: 2, party: 'Família Moreira' },
        params: {},
      },
    ]);
    expect(result.counts).toEqual({ valid: 2, errors: 0, duplicates: 1 });
  });

  it('RN07 - avisa o grupo com nome de um grupo ativo, sem bloquear', () => {
    const result = check([row('familia rocha', 'Márcia')], { parties: ['Família Rocha'] });

    expect(result.warnings).toEqual([{ code: 'PARTY_NAME_EXISTS', party: 'familia rocha' }]);
    expect(result.parties).toHaveLength(1);
  });

  it('RN08 - usa a tag ativa (sem maiúsculas e espaços), cria as novas até 10 na ordem de primeira aparição e avisa as outras', () => {
    const active = Array.from({ length: 8 }, (_, i) => `Tag ${i}`);
    const result = check(
      [
        row('A', 'Ana', null, null, null, null, 'tag  0, Nova 1, Nova 1'),
        row('A', 'Bia', null, null, null, null, 'Nova 2, Nova 3'),
        row('B', 'Caio', null, null, null, null, 'Nova 3, Nova 2'),
      ],
      { tags: active },
    );

    expect(result.tagsToCreate).toEqual(['Nova 1', 'Nova 2']);
    expect(result.parties[0].guests.map((guest) => guest.tags)).toEqual([
      ['tag 0', 'Nova 1'],
      ['Nova 2'],
    ]);
    expect(result.parties[1].guests[0].tags).toEqual(['Nova 2']);
    expect(result.warnings).toEqual([{ code: 'TAG_LIMIT', tag: 'Nova 3', rows: [3, 4] }]);
  });

  it('RN03 - mais de 1.000 linhas de convidado recusa o arquivo; linhas em branco não contam', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row('G', `P${i}`));
    expect(
      typeof checkSpreadsheet({
        rows: [...rows, row()],
        firstRow: 2,
        activePartyNames: [],
        activeTagNames: [],
      }),
    ).toBe('object');
    expect(
      checkSpreadsheet({
        rows: [...rows, row('G', 'Mais')],
        firstRow: 2,
        activePartyNames: [],
        activeTagNames: [],
      }),
    ).toBe('TOO_MANY_ROWS');
  });
});
