import type { CellValue } from '../../domain/spreadsheet-import';

/** A primeira aba da planilha: a linha dos títulos e as outras, em texto ou número. */
export interface SpreadsheetSheet {
  header: CellValue[];
  /** Da linha 2 em diante, cada uma com as 7 células do modelo. */
  rows: CellValue[][];
}

/**
 * Lê um .xlsx (ADR-39): recusa com FileTooLargeError o que passa de 50 MB
 * descompactado e com SpreadsheetRefusedError(NOT_XLSX) o que não é .xlsx.
 */
export interface SpreadsheetReader {
  read({ file }: { file: Buffer }): Promise<SpreadsheetSheet>;
}

export const SPREADSHEET_READER = Symbol('SpreadsheetReader');
