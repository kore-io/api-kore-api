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

/** Lado maior da versão servida (S4 RN03 e RN05). */
export const SITE_IMAGE_DISPLAY_MAX_PX = 2560;
/** Lado maior da miniatura (S4 RN05). */
export const SITE_IMAGE_THUMB_MAX_PX = 640;
/** A prévia do link (S4 RN05; Site público RN09): 1200 × 630, até 300 KB. */
export const SITE_IMAGE_OG = { width: 1200, height: 630, maxBytes: 300 * 1024 } as const;
/** Teto de pixels da entrada, contra bomba de descompressão (S4 RN05). */
export const SITE_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
/** As versões servidas saem do cache em até 1 dia, sem `immutable` (S4 RN06). */
export const SITE_IMAGE_CACHE_CONTROL = 'public, max-age=86400';

export type SiteImageSourceType = 'jpeg' | 'png';

/**
 * O tipo real pelo conteúdo (S4 RN05): a assinatura de JPEG ou de PNG nos
 * primeiros bytes. O tipo declarado no envio não vale.
 */
export function detectSiteImageType({ head }: { head: Uint8Array }): SiteImageSourceType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length >= png.length && png.every((byte, index) => head[index] === byte)) return 'png';
  return null;
}
