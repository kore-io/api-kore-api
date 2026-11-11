import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { ExportRenderer } from '../application/ports/export-reader.port';
import { cellText, COLUMN_TITLES, type ExportColumn, type ExportGuest } from '../domain/export';

/**
 * O Excel da exportação (RN01 e RN04; ADR-39): uma linha de títulos e uma por
 * convidado, sem resumo. Toda célula é string: um nome "=SOMA(A1:A2)" ou um
 * telefone "+55…" sai como texto, sem fórmula e sem prefixo.
 */
@Injectable()
export class ExceljsExportRenderer implements ExportRenderer {
  async xlsx({
    guests,
    columns,
  }: {
    guests: readonly ExportGuest[];
    columns: readonly ExportColumn[];
  }): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Convidados');
    sheet.addRow(columns.map((column) => COLUMN_TITLES[column])).font = { bold: true };
    for (const guest of guests) {
      const row = sheet.addRow([]);
      columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        // Atribuição direta de string: o exceljs grava como texto (t="s" ou
        // inlineStr), nunca como fórmula.
        cell.value = cellText({ guest, column });
        cell.numFmt = '@';
      });
    }
    columns.forEach((_, index) => (sheet.getColumn(index + 1).width = 24));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
