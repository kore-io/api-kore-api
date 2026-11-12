import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type {
  SongSuggestionRow,
  SongSuggestionsFile,
} from '../application/ports/song-suggestion-reader.port';

const TITLES = ['Música', 'Quem sugeriu', 'Grupo', 'Data da sugestão'];

/** "12/09 às 20h14", no fuso do casamento (Música RN05 e RN06). */
export function suggestionDate({ at, timezone }: { at: Date; timezone: string }): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month} às ${parts.hour}h${parts.minute}`;
}

/**
 * A lista para o DJ (Música RN06): o Excel com as colunas da página, na mesma
 * ordem, sem juntar repetidas. Toda célula é texto (as regras da exportação da
 * F1): uma música "=SOMA(A1)" sai como texto, sem fórmula.
 */
@Injectable()
export class SongSuggestionsXlsx implements SongSuggestionsFile {
  async render({
    rows,
    timezone,
  }: {
    rows: readonly SongSuggestionRow[];
    timezone: string;
  }): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Músicas');
    sheet.addRow(TITLES).font = { bold: true };
    for (const row of rows) {
      const line = sheet.addRow([]);
      [
        row.song,
        row.guestName ?? '',
        row.partyName,
        suggestionDate({ at: row.suggestedAt, timezone }),
      ].forEach((value, index) => {
        const cell = line.getCell(index + 1);
        cell.value = value;
        cell.numFmt = '@';
      });
    }
    TITLES.forEach((_, index) => (sheet.getColumn(index + 1).width = 28));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
}
