/** O casamento já tem 40 imagens guardadas (409 SITE_IMAGE_LIMIT; S4 RN07). */
export class SiteImageLimitReachedError extends Error {
  override name = 'SiteImageLimitReachedError';
}

/** A imagem não é deste casamento ou está `failed` (404 IMAGE_NOT_FOUND; S4 RN05). */
export class SiteImageNotFoundError extends Error {
  override name = 'SiteImageNotFoundError';
}

/** Outra confirmação já está processando a imagem (409 IMAGE_PROCESSING; S4 RN05). */
export class SiteImageProcessingError extends Error {
  override name = 'SiteImageProcessingError';
}

/** O original não chegou ao armazenamento (409 UPLOAD_MISSING; S4 RN05). */
export class SiteImageUploadMissingError extends Error {
  override name = 'SiteImageUploadMissingError';
}

/**
 * O arquivo não serve: não é JPEG nem PNG, passa de 4 MB, de 40 MP ou não pôde
 * ser lido (422 IMAGE_INVALID; S4 RN05). A imagem fica `failed`.
 */
export class SiteImageInvalidError extends Error {
  override name = 'SiteImageInvalidError';
}
