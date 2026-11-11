import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import type {
  SpreadsheetReader,
  SpreadsheetSheet,
} from '../application/ports/spreadsheet-reader.port';
import { FileTooLargeError, SpreadsheetRefusedError } from '../domain/guests.errors';
import { TEMPLATE_HEADERS, type CellValue } from '../domain/spreadsheet-import';

/** Limite do conteúdo descompactado, contra zip bomb (ADR-39; decisão 189, item 8). */
export const UNZIPPED_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Conta os bytes reais na descompactação em stream e aborta assim que passa do
 * limite: o tamanho declarado no diretório do zip não vale, porque um zip bomb
 * pode mentir nele. Não é zip: NOT_XLSX.
 */
export function assertUnzippedSize({
  file,
  maxBytes = UNZIPPED_MAX_BYTES,
}: {
  file: Buffer;
  maxBytes?: number;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(file, { lazyEntries: true, validateEntrySizes: false }, (openError, zip) => {
      if (openError || !zip) {
        reject(new SpreadsheetRefusedError({ code: 'NOT_XLSX' }));
        return;
      }
      let total = 0;
      let done = false;
      const fail = (error: Error) => {
        if (done) return;
        done = true;
        zip.close();
        reject(error);
      };
      zip.on('error', () => fail(new SpreadsheetRefusedError({ code: 'NOT_XLSX' })));
      zip.on('end', () => {
        if (done) return;
        done = true;
        resolve();
      });
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) {
            fail(new SpreadsheetRefusedError({ code: 'NOT_XLSX' }));
            return;
          }
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
              stream.destroy();
              fail(new FileTooLargeError());
            }
          });
          stream.on('error', () => fail(new SpreadsheetRefusedError({ code: 'NOT_XLSX' })));
          stream.on('end', () => {
            if (!done) zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/** O valor da célula como texto ou número (rich text, link e fórmula pelo resultado). */
function cellValue(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('hyperlink' in value) return cellValue(value.text);
  if ('result' in value) return cellValue(value.result);
  if ('error' in value) return null;
  return null;
}

/** exceljs para o .xlsx (ADR-39), depois da passada do yauzl. Só a primeira aba (RN03). */
@Injectable()
export class ExceljsSpreadsheetReader implements SpreadsheetReader {
  async read({ file }: { file: Buffer }): Promise<SpreadsheetSheet> {
    await assertUnzippedSize({ file });
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch {
      throw new SpreadsheetRefusedError({ code: 'NOT_XLSX' });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new SpreadsheetRefusedError({ code: 'NOT_XLSX' });

    const columns = TEMPLATE_HEADERS.length;
    const read = (rowNumber: number): CellValue[] => {
      const row = sheet.getRow(rowNumber);
      return Array.from({ length: columns }, (_, index) => cellValue(row.getCell(index + 1).value));
    };
    const rows: CellValue[][] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) rows.push(read(rowNumber));
    return { header: read(1), rows };
  }
}
