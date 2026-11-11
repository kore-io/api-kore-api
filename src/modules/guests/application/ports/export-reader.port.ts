import type { ExportColumn, ExportGuest, ExportWho } from '../../domain/export';

export interface ExportWedding {
  slug: string;
  timezone: string | null;
}

/** Leituras da exportação, na transação da requisição (RLS ligada). */
export interface ExportReader {
  wedding({ weddingId }: { weddingId: string }): Promise<ExportWedding | null>;
  isActiveTag({ weddingId, tagId }: { weddingId: string; tagId: string }): Promise<boolean>;
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

/** Gera o arquivo (ADR-39). */
export interface ExportRenderer {
  xlsx({
    guests,
    columns,
  }: {
    guests: readonly ExportGuest[];
    columns: readonly ExportColumn[];
  }): Promise<Buffer>;
}

export const EXPORT_RENDERER = Symbol('ExportRenderer');
