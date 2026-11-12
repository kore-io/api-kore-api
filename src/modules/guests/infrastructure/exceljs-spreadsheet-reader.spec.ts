import ExcelJS from 'exceljs';
import { FileTooLargeError, SpreadsheetRefusedError } from '../domain/guests.errors';
import { assertUnzippedSize, ExceljsSpreadsheetReader } from './exceljs-spreadsheet-reader';

async function xlsx(rows: unknown[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Convidados');
  for (const row of rows) sheet.addRow(row);
  workbook.addWorksheet('Outra').addRow(['ignorada']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Leitura da planilha (ADR-39; Importação RN03)', () => {
  it('ADR-39 - conta os bytes reais descompactados e recusa acima do limite (zip bomb)', async () => {
    const file = await xlsx([['Grupo'], ['x'.repeat(5000)]]);

    await expect(assertUnzippedSize({ file, maxBytes: 1000 })).rejects.toBeInstanceOf(
      FileTooLargeError,
    );
    await expect(assertUnzippedSize({ file })).resolves.toBeUndefined();
  });

  it('RN01 - o que não é zip nem .xlsx é NOT_XLSX', async () => {
    await expect(assertUnzippedSize({ file: Buffer.from('nao e zip') })).rejects.toMatchObject({
      code: 'NOT_XLSX',
    });
    await expect(
      new ExceljsSpreadsheetReader().read({ file: Buffer.from('Grupo;Nome\n') }),
    ).rejects.toBeInstanceOf(SpreadsheetRefusedError);
  });

  it('RN03 - lê só a primeira aba, as 7 colunas, com texto, número, link e rich text', async () => {
    const file = await xlsx([
      [
        'Grupo',
        'Nome',
        'Telefone',
        'E-mail',
        'Faixa etária',
        'Restrição alimentar',
        'Tags',
        'Extra',
      ],
      [
        'Família Moreira',
        { richText: [{ text: 'Célia ' }, { text: 'Moreira' }] },
        19998763310,
        { text: 'celia@exemplo.kore.local', hyperlink: 'mailto:celia@exemplo.kore.local' },
        'Adulta',
        null,
        'Família da Ana',
        'ignorada',
      ],
    ]);

    const sheet = await new ExceljsSpreadsheetReader().read({ file });

    expect(sheet.header).toHaveLength(7);
    expect(sheet.rows).toEqual([
      [
        'Família Moreira',
        'Célia Moreira',
        19998763310,
        'celia@exemplo.kore.local',
        'Adulta',
        null,
        'Família da Ana',
      ],
    ]);
  });
});
