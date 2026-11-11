/** O casamento já tem 40 imagens guardadas (409 SITE_IMAGE_LIMIT; S4 RN07). */
export class SiteImageLimitReachedError extends Error {
  override name = 'SiteImageLimitReachedError';
}

/**
 * A imagem não é `ready` deste casamento (404 IMAGE_NOT_FOUND; S4 RN05 e
 * RN10). Nas seções, traz os ids recusados.
 */
export class SiteImageNotFoundError extends Error {
  override name = 'SiteImageNotFoundError';
  readonly imageIds: readonly string[] | undefined;

  constructor({ imageIds }: { imageIds?: readonly string[] } = {}) {
    super();
    this.imageIds = imageIds;
  }
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

export interface SiteFieldIssue {
  path: string;
  code: string;
  params: Record<string, unknown>;
}

/** Campos que o DTO não valida sozinho (WhatsApp, Partner, formato do endereço): 400. */
export class SiteFieldsInvalidError extends Error {
  override name = 'SiteFieldsInvalidError';
  readonly issues: readonly SiteFieldIssue[];

  constructor({ issues }: { issues: readonly SiteFieldIssue[] }) {
    super();
    this.issues = issues;
  }
}

/**
 * Sem `manage_site_identity`, a data, a UF ou o endereço chegaram diferentes
 * do atual (403 FIELD_NOT_ALLOWED; Dados básicos RN04).
 */
export class SiteFieldNotAllowedError extends Error {
  override name = 'SiteFieldNotAllowedError';
  readonly fields: readonly string[];

  constructor({ fields }: { fields: readonly string[] }) {
    super();
    this.fields = fields;
  }
}

/** O site já foi publicado: o endereço não muda (409 SLUG_LOCKED; Dados básicos RN05). */
export class SiteSlugLockedError extends Error {
  override name = 'SiteSlugLockedError';
}

/** Endereço em uso ou reservado (409 SLUG_UNAVAILABLE; Dados básicos RN06). */
export class SiteSlugUnavailableError extends Error {
  override name = 'SiteSlugUnavailableError';
  readonly reason: 'taken' | 'reserved';
  readonly suggestion: string | null;

  constructor({ reason, suggestion }: { reason: 'taken' | 'reserved'; suggestion: string | null }) {
    super();
    this.reason = reason;
    this.suggestion = suggestion;
  }
}

/** A cor bloqueada pelo guarda-corpo (422 CONTRAST_TOO_LOW; Aparência RN04 e RN05). */
export class ContrastTooLowError extends Error {
  override name = 'ContrastTooLowError';
  readonly check: 'primary_foreground' | 'primary_background';
  /** Duas casas, para baixo. */
  readonly ratio: number;

  constructor({
    check,
    ratio,
  }: {
    check: 'primary_foreground' | 'primary_background';
    ratio: number;
  }) {
    super();
    this.check = check;
    this.ratio = ratio;
  }
}

/** O endereço não existe ou o casamento foi expurgado (404 SITE_NOT_FOUND; Site público RN04). */
export class SiteNotFoundError extends Error {
  override name = 'SiteNotFoundError';
}

/** O casamento está em rascunho (404 SITE_DRAFT; Site público RN04): sem dado nenhum. */
export class SiteDraftError extends Error {
  override name = 'SiteDraftError';
}

/**
 * Token inexistente, regenerado ou de grupo na lixeira, num site publicado
 * (404 LINK_INVALID; Site público RN06): "Este link não funciona mais."
 */
export class SiteLinkInvalidError extends Error {
  override name = 'SiteLinkInvalidError';
}

/** Falhas demais do mesmo IP no link do grupo (429 RATE_LIMITED; Site público RN06). */
export class PartyLinkRateLimitedError extends Error {
  override name = 'PartyLinkRateLimitedError';
}
