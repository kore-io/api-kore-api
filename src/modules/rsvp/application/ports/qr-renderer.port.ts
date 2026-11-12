/** O QR do convite impresso (Envios RN09): só o link do grupo, com correção de erro M. */
export interface QrRenderer {
  /** PNG de 1024 × 1024. */
  png({ url }: { url: string }): Promise<Buffer>;
  /** PDF A4, um QR por página, com o nome do grupo embaixo e nada mais. */
  pdf({ pages }: { pages: readonly { url: string; name: string }[] }): Promise<Buffer>;
}

export const QR_RENDERER = Symbol('QrRenderer');
