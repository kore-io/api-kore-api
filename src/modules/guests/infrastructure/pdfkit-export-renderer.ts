import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { PdfHeading } from '../application/ports/export-reader.port';
import {
  cellText,
  COLUMN_TITLES,
  formatPhone,
  type ExportColumn,
  type ExportGuest,
} from '../domain/export';

/** As fontes embutidas (OFL; ver fonts/README.md). */
const FONTS_DIR = join(__dirname, 'fonts');
const FONT = {
  display: join(FONTS_DIR, 'CormorantGaramond-SemiBold.ttf'),
  regular: join(FONTS_DIR, 'NunitoSans-Regular.ttf'),
  semibold: join(FONTS_DIR, 'NunitoSans-SemiBold.ttf'),
  bold: join(FONTS_DIR, 'NunitoSans-Bold.ttf'),
};

/** As cores do desenho (DS: Tinta, Cinza 700, Cinza 300, Cinza 100). */
const COLOR = { ink: '#241a1e', gray700: '#5c5055', divider: '#e3d9db', band: '#f4efef' };

/**
 * O desenho é de 794×1123 px (A4 a 96 dpi); o PDF é em pontos (595,28×841,89):
 * cada px do Penpot é 0,75 pt. As medidas abaixo são as do desenho, em px.
 */
const PX = 0.75;
const LAYOUT = {
  left: 40,
  width: 714,
  firstTop: 48,
  /** Onde o espaço da tabela acaba: o divisor do rodapé (1031) menos o respiro (24). */
  tableBottom: 1007,
  headerHeight: 39,
  groupHeight: 29,
  rowHeight: 27,
  footerDivider: 1031,
  footerText: 1068,
};

/** A largura de cada coluna no desenho (somam 714); com menos colunas, crescem na proporção. */
const COLUMN_WIDTHS: Record<ExportColumn, number> = {
  name: 120,
  party: 104,
  ageGroup: 76,
  dietaryRestriction: 104,
  rsvp: 80,
  phone: 110,
  tags: 120,
};

/** Grupo de até 10 pessoas não é cortado entre duas páginas (RN01). */
const KEEP_TOGETHER_MAX = 10;

export interface Group {
  name: string;
  guests: ExportGuest[];
}

/** Os convidados agrupados, na ordem em que vieram (RN03). */
export function groupsOf(guests: readonly ExportGuest[]): Group[] {
  const groups: Group[] = [];
  for (const guest of guests) {
    const last = groups.at(-1);
    if (last && last.name === guest.party) last.guests.push(guest);
    else groups.push({ name: guest.party, guests: [guest] });
  }
  return groups;
}

export type PlannedBlock =
  | { page: number; y: number; kind: 'group'; name: string }
  | { page: number; y: number; kind: 'guest'; guest: ExportGuest }
  | { page: number; y: number; kind: 'rule' };

/**
 * A paginação da tabela (RN01), sem desenhar: cada bloco com a página (0 = a
 * primeira) e o y em px do desenho. tableTop é onde as linhas começam na
 * primeira página (depois do topo, do resumo e dos títulos); nas outras,
 * depois dos títulos repetidos. Um grupo de até 10 pessoas que não cabe vai
 * inteiro para a página seguinte; um maior começa onde estiver (se couber o
 * nome e uma pessoa) e continua na seguinte, com o nome do grupo repetido.
 */
export function planPages({
  groups,
  tableTop,
}: {
  groups: readonly Group[];
  tableTop: number;
}): PlannedBlock[] {
  const nextPageTop = LAYOUT.firstTop + LAYOUT.headerHeight + 1;
  const blocks: PlannedBlock[] = [];
  let page = 0;
  let y = tableTop;
  // Um grupo que não cabe numa página sem grupos não tem para onde ir: começa nela.
  let groupsOnPage = 0;
  const newPage = () => {
    page += 1;
    y = nextPageTop;
    groupsOnPage = 0;
  };
  for (const group of groups) {
    const blockHeight = LAYOUT.groupHeight + group.guests.length * LAYOUT.rowHeight + 1;
    const keepTogether = group.guests.length <= KEEP_TOGETHER_MAX;
    if (
      groupsOnPage > 0 &&
      ((keepTogether && y + blockHeight > LAYOUT.tableBottom) ||
        y + LAYOUT.groupHeight + LAYOUT.rowHeight > LAYOUT.tableBottom)
    )
      newPage();
    groupsOnPage += 1;
    blocks.push({ page, y, kind: 'group', name: group.name });
    y += LAYOUT.groupHeight;
    for (const guest of group.guests) {
      if (y + LAYOUT.rowHeight > LAYOUT.tableBottom) {
        newPage();
        groupsOnPage = 1;
        blocks.push({ page, y, kind: 'group', name: group.name });
        y += LAYOUT.groupHeight;
      }
      blocks.push({ page, y, kind: 'guest', guest });
      y += LAYOUT.rowHeight;
    }
    blocks.push({ page, y, kind: 'rule' });
    y += 1;
  }
  return blocks;
}

/**
 * O PDF "para o cerimonial" (Exportação RN01; tela "Screen / Exportar — PDF /
 * A4" do Penpot, decisão 194), com pdfkit e as fontes embutidas (ADR-39): o
 * topo (casal, data · cidade, filtro), o resumo, a tabela agrupada por grupo
 * com os títulos repetidos em cada página, e o rodapé "Gerado pelo Kore em …"
 * · "Página X de Y". O telefone sai inteiro, formatado.
 */
export function renderExportPdf({
  guests,
  columns,
  heading,
}: {
  guests: readonly ExportGuest[];
  columns: readonly ExportColumn[];
  heading: PdfHeading;
}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
    info: { Title: `Convidados · ${heading.title}`, Creator: 'Kore' },
  });
  doc.registerFont('display', FONT.display);
  doc.registerFont('regular', FONT.regular);
  doc.registerFont('semibold', FONT.semibold);
  doc.registerFont('bold', FONT.bold);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const total = columns.reduce((sum, column) => sum + COLUMN_WIDTHS[column], 0);
  const widths = columns.map((column) => (COLUMN_WIDTHS[column] / total) * LAYOUT.width);
  const xs = widths.map(
    (_, index) => LAYOUT.left + widths.slice(0, index).reduce((sum, width) => sum + width, 0),
  );

  /** O texto da célula vai até a coluna seguinte, com 4 px de folga; a última vai até a borda. */
  const cellWidth = (index: number) => widths[index] - (index === widths.length - 1 ? 0 : 4);

  const text = (
    value: string,
    {
      x,
      y,
      width,
      font,
      size,
      color,
      spacing = 0,
      wrap = false,
    }: {
      x: number;
      y: number;
      width?: number;
      font: keyof typeof FONT;
      size: number;
      color: string;
      spacing?: number;
      wrap?: boolean;
    },
  ) =>
    doc
      .font(font)
      .fontSize(size * PX)
      .fillColor(color)
      .text(value, x * PX, y * PX, {
        ...(width ? { width: width * PX } : {}),
        characterSpacing: spacing * PX,
        lineGap: 0,
        ...(wrap ? {} : { lineBreak: false, ellipsis: true, height: size * 1.2 * PX }),
      });
  const rule = (y: number) =>
    doc.rect(LAYOUT.left * PX, y * PX, LAYOUT.width * PX, 1 * PX).fill(COLOR.divider);

  /** Os títulos da tabela; os de duas linhas ("FAIXA ETÁRIA") ficam centralizados na altura. */
  const tableHeader = (top: number): number => {
    columns.forEach((column, index) => {
      const title = COLUMN_TITLES[column].toUpperCase();
      doc.font('bold').fontSize(11 * PX);
      const height =
        doc.heightOfString(title, {
          width: widths[index] * PX - 8 * PX,
          characterSpacing: 0.9 * PX,
        }) / PX;
      text(title, {
        x: xs[index],
        y: top + (LAYOUT.headerHeight - height) / 2,
        width: widths[index] - 8,
        font: 'bold',
        size: 11,
        color: COLOR.gray700,
        spacing: 0.9,
        wrap: true,
      });
    });
    rule(top + LAYOUT.headerHeight);
    return top + LAYOUT.headerHeight + 1;
  };

  const groupRow = (top: number, name: string): number => {
    doc
      .rect(LAYOUT.left * PX, top * PX, LAYOUT.width * PX, LAYOUT.groupHeight * PX)
      .fill(COLOR.band);
    text(name, {
      x: LAYOUT.left + 8,
      y: top + 6,
      width: LAYOUT.width - 16,
      font: 'semibold',
      size: 14,
      color: COLOR.ink,
    });
    return top + LAYOUT.groupHeight;
  };

  const guestRow = (top: number, guest: ExportGuest): number => {
    columns.forEach((column, index) => {
      const value =
        column === 'phone' && guest.phone
          ? formatPhone({ e164: guest.phone })
          : cellText({ guest, column });
      text(value, {
        x: xs[index],
        y: top + 6,
        width: cellWidth(index),
        font: 'regular',
        size: 12,
        color: COLOR.ink,
      });
    });
    return top + LAYOUT.rowHeight;
  };

  // Página 1: o topo e o resumo.
  text(heading.title, {
    x: LAYOUT.left,
    y: LAYOUT.firstTop,
    width: LAYOUT.width,
    font: 'display',
    size: 28,
    color: COLOR.ink,
  });
  let y = LAYOUT.firstTop + 38;
  if (heading.eventLine) {
    text(heading.eventLine, {
      x: LAYOUT.left,
      y,
      width: LAYOUT.width,
      font: 'regular',
      size: 14,
      color: COLOR.gray700,
    });
    y += 21;
  }
  text(heading.filter, {
    x: LAYOUT.left,
    y,
    width: LAYOUT.width,
    font: 'semibold',
    size: 14,
    color: COLOR.ink,
  });
  y += 41;
  text(heading.summary, {
    x: LAYOUT.left,
    y,
    width: LAYOUT.width,
    font: 'regular',
    size: 14,
    color: COLOR.ink,
  });
  y = tableHeader(y + 41);

  // A paginação vem pronta da função pura; aqui só se desenha.
  let page = 0;
  for (const block of planPages({ groups: groupsOf(guests), tableTop: y })) {
    while (page < block.page) {
      doc.addPage({ size: 'A4', margin: 0 });
      tableHeader(LAYOUT.firstTop);
      page += 1;
    }
    if (block.kind === 'group') groupRow(block.y, block.name);
    else if (block.kind === 'guest') guestRow(block.y, block.guest);
    else rule(block.y);
  }

  // O rodapé em todas as páginas, com o total que só se sabe no fim.
  const { start, count } = doc.bufferedPageRange();
  for (let page = start; page < start + count; page++) {
    doc.switchToPage(page);
    rule(LAYOUT.footerDivider);
    text(heading.generated, {
      x: LAYOUT.left,
      y: LAYOUT.footerText,
      width: 400,
      font: 'regular',
      size: 12,
      color: COLOR.gray700,
    });
    const label = `Página ${page - start + 1} de ${count}`;
    doc.font('regular').fontSize(12 * PX);
    const labelWidth = doc.widthOfString(label) / PX;
    text(label, {
      x: LAYOUT.left + LAYOUT.width - labelWidth,
      y: LAYOUT.footerText,
      font: 'regular',
      size: 12,
      color: COLOR.gray700,
    });
  }
  doc.end();
  return done;
}
