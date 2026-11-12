import type { ExportColumn, ExportGuest, ExportWho } from '../../domain/export';

export interface ExportWedding {
  slug: string;
  timezone: string | null;
  /** "Ana & Marcos" (o primeiro nome dos dois noivos, como na F0). */
  coupleNames: string;
  eventDate: Date | null;
  city: string | null;
  state: string | null;
}

/** Leituras da exportação, na transação da requisição (RLS ligada). */
export interface ExportReader {
  wedding({ weddingId }: { weddingId: string }): Promise<ExportWedding | null>;
  /** O nome da tag ativa do casamento, ou null. */
  activeTagName({ weddingId, tagId }: { weddingId: string; tagId: string }): Promise<string | null>;
  /**
   * Os convidados ativos com nome (sem vagas vazias, RN03), do filtro (RN02),
   * por grupo em ordem alfabética sem acento e na ordem do grupo (RN17).
   */
  guests({
    weddingId,
    who,
    tagId,
  }: {
    weddingId: string;
    who: ExportWho;
    tagId?: string;
  }): Promise<ExportGuest[]>;
}

export const EXPORT_READER = Symbol('ExportReader');

/** O topo e o rodapé do PDF (RN01). */
export interface PdfHeading {
  title: string;
  eventLine: string;
  filter: string;
  summary: string;
  generated: string;
}

/** Gera o arquivo (ADR-39). */
export interface ExportRenderer {
  pdf({
    guests,
    columns,
    heading,
  }: {
    guests: readonly ExportGuest[];
    columns: readonly ExportColumn[];
    heading: PdfHeading;
  }): Promise<Buffer>;
  xlsx({
    guests,
    columns,
  }: {
    guests: readonly ExportGuest[];
    columns: readonly ExportColumn[];
  }): Promise<Buffer>;
}

export const EXPORT_RENDERER = Symbol('ExportRenderer');
