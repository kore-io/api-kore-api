/** O casamento já tem 40 imagens guardadas (409 SITE_IMAGE_LIMIT; S4 RN07). */
export class SiteImageLimitReachedError extends Error {
  override name = 'SiteImageLimitReachedError';
}
