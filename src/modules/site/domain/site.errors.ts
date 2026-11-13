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

/**
 * A data, a UF ou o endereço com uma publicação aguardando pagamento (409
 * PAYMENT_PENDING; Publicar e pagar RN08, B2-9): o pagamento foi cotado com
 * eles e, mudados, ele não teria destino.
 */
export class SitePaymentPendingError extends Error {
  override name = 'SitePaymentPendingError';
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

/** O casamento ainda não tem endereço (409 SITE_SLUG_MISSING; Pré-visualização RN01). */
export class SiteSlugMissingError extends Error {
  override name = 'SiteSlugMissingError';
}

/** O grupo não é do casamento ou está na lixeira (404 PARTY_NOT_FOUND; Pré-visualização RN09). */
export class SitePartyNotFoundError extends Error {
  override name = 'SitePartyNotFoundError';
}

/**
 * Token da prévia inexistente, usado, vencido, de outro casamento ou de quem
 * perdeu o vínculo (404 PREVIEW_INVALID; Pré-visualização RN04).
 */
export class PreviewInvalidError extends Error {
  override name = 'PreviewInvalidError';
}

/** Sem cookie da prévia válido (401 PREVIEW_REQUIRED; Pré-visualização RN05 e RN06). */
export class PreviewRequiredError extends Error {
  override name = 'PreviewRequiredError';
}

/** Só se publica de rascunho (409 NOT_DRAFT; Publicação RN03). */
export class NotDraftError extends Error {
  override name = 'NotDraftError';
}

/** Sem data ou sem fuso do casamento (409 EVENT_DATE_MISSING; Publicação RN04). */
export class EventDateMissingError extends Error {
  override name = 'EventDateMissingError';
}

/**
 * Data de saída do ar fora dos limites (422 END_DATE_OUT_OF_RANGE; Publicação
 * RN04 e RN11), com os limites para o texto "Escolham uma data depois do
 * casamento e até {limite}.".
 */
export class EndDateOutOfRangeError extends Error {
  override name = 'EndDateOutOfRangeError';
  readonly endDateMin: string | null;
  readonly endDateMax: string | null;

  constructor({
    endDateMin,
    endDateMax,
  }: {
    endDateMin: string | null;
    endDateMax: string | null;
  }) {
    super();
    this.endDateMin = endDateMin;
    this.endDateMax = endDateMax;
  }
}

/** Site expirado ou com exclusão agendada (410 SITE_EXPIRED; Data de saída do ar RN08). */
export class SiteExpiredError extends Error {
  override name = 'SiteExpiredError';
}

/** Site bloqueado (423 SITE_UNAVAILABLE; Casamento bloqueado RN05). */
export class SiteUnavailableError extends Error {
  override name = 'SiteUnavailableError';
}
