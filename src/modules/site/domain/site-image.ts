/** Imagens guardadas por casamento: `uploading`, `processing` e `ready` (S4 RN07). */
export const SITE_IMAGES_PER_WEDDING_MAX = 40;

/** Teto do arquivo enviado, já comprimido no aparelho (S4 RN03 e RN05). */
export const SITE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** O app sempre envia JPEG (S4 RN03); o tipo real é lido pelo conteúdo na confirmação. */
export const SITE_IMAGE_UPLOAD_CONTENT_TYPES = ['image/jpeg'] as const;
export type SiteImageUploadContentType = (typeof SITE_IMAGE_UPLOAD_CONTENT_TYPES)[number];

/** Validade da URL pré-assinada (S4 RN04; ADR do upload direto). */
export const SITE_IMAGE_UPLOAD_SECONDS = 5 * 60;

export type SiteImageStatus = 'uploading' | 'processing' | 'ready' | 'failed';

/** Contam no limite da RN07. */
export const STORED_SITE_IMAGE_STATUSES: readonly SiteImageStatus[] = [
  'uploading',
  'processing',
  'ready',
];

/**
 * Chaves de uma imagem (S4 RN06): sem o weddingId (um UUIDv7, que revela a data
 * de criação do casamento). O original fica no bucket privado; as três versões,
 * no público, servidas pelo CDN.
 */
export function siteImageKeys({ imageId }: { imageId: string }): {
  original: string;
  display: string;
  thumb: string;
  og: string;
} {
  const base = `site/${imageId}`;
  return {
    original: `${base}/original`,
    display: `${base}/display.jpg`,
    thumb: `${base}/thumb.jpg`,
    og: `${base}/og.jpg`,
  };
}
