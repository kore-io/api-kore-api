export interface ProcessedVersion {
  body: Buffer;
  width: number;
  height: number;
}

export interface ProcessedSiteImage {
  display: ProcessedVersion;
  thumb: ProcessedVersion;
  og: ProcessedVersion;
}

/**
 * Recodifica a imagem (S4 RN05): orientação aplicada, sRGB, fundo branco no
 * lugar da transparência, JPEG sem nenhum metadado (EXIF, XMP, GPS, ICC), com
 * as três versões. Recusa com SiteImageInvalidError o que não consegue ler ou
 * passa do teto de pixels.
 */
export interface SiteImageProcessor {
  process({ source }: { source: Buffer }): Promise<ProcessedSiteImage>;
}

export const SITE_IMAGE_PROCESSOR = Symbol('SiteImageProcessor');
