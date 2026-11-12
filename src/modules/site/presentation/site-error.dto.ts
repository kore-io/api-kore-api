import { ApiProperty } from '@nestjs/swagger';

/** Erros de regra do contexto Site, no formato nativo (decisão 99). */

/** "Muitas fotos foram trocadas neste site hoje. Tentem de novo amanhã." (S4 RN07). */
export class SiteImageLimitErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SITE_IMAGE_LIMIT'] }) error: 'SITE_IMAGE_LIMIT';
  @ApiProperty() message: string;
}

export class SiteImageNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['IMAGE_NOT_FOUND'] }) error: 'IMAGE_NOT_FOUND';
  @ApiProperty() message: string;
  /** Nas seções: os ids que não são imagens prontas deste casamento. */
  @ApiProperty({ type: [String], required: false }) imageIds?: string[];
}

/** Outra confirmação está processando: o app tenta de novo em instantes (S4 RN05). */
export class SiteImageProcessingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['IMAGE_PROCESSING'] }) error: 'IMAGE_PROCESSING';
  @ApiProperty() message: string;
}

/** O original não chegou ao armazenamento (S4 RN05). */
export class SiteImageUploadMissingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['UPLOAD_MISSING'] }) error: 'UPLOAD_MISSING';
  @ApiProperty() message: string;
}

/** "Não foi possível usar esta foto. Escolham uma foto JPG ou PNG." (S4 RN02 e RN05). */
export class SiteImageInvalidErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['IMAGE_INVALID'] }) error: 'IMAGE_INVALID';
  @ApiProperty() message: string;
}

/** Sem `manage_site_identity`, a data, a UF ou o endereço vieram diferentes (Dados básicos RN04). */
export class SiteFieldNotAllowedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['FIELD_NOT_ALLOWED'] }) error: 'FIELD_NOT_ALLOWED';
  @ApiProperty() message: string;
  @ApiProperty({ type: [String], enum: ['eventDate', 'state', 'slug'] }) fields: string[];
}

/** "O site já foi publicado, então o endereço não muda mais." (Dados básicos RN05). */
export class SiteSlugLockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SLUG_LOCKED'] }) error: 'SLUG_LOCKED';
  @ApiProperty() message: string;
}

/** Endereço em uso ou reservado, com a sugestão (Dados básicos RN06). */
export class SiteSlugUnavailableErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SLUG_UNAVAILABLE'] }) error: 'SLUG_UNAVAILABLE';
  @ApiProperty() message: string;
  @ApiProperty({ enum: ['taken', 'reserved'] }) reason: 'taken' | 'reserved';
  @ApiProperty({ type: String, nullable: true }) suggestion: string | null;
}

/** A cor bloqueada; o app escolhe o texto pelo check (Aparência RN04 e RN05). */
export class ContrastTooLowErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['CONTRAST_TOO_LOW'] }) error: 'CONTRAST_TOO_LOW';
  @ApiProperty() message: string;
  @ApiProperty({ enum: ['primary_foreground', 'primary_background'] })
  check: 'primary_foreground' | 'primary_background';
  /** A razão medida, com duas casas para baixo. */
  @ApiProperty() ratio: number;
}

/** "Não encontramos este endereço." (Site público RN04). */
export class SiteNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['SITE_NOT_FOUND'] }) error: 'SITE_NOT_FOUND';
  @ApiProperty() message: string;
}

/** "Este site ainda não foi publicado." — sem dado nenhum do casal (Site público RN04). */
export class SiteDraftErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['SITE_DRAFT'] }) error: 'SITE_DRAFT';
  @ApiProperty() message: string;
}

/** "Este link não funciona mais. Peça um novo link ao casal." (Site público RN06). */
export class SiteLinkInvalidErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['LINK_INVALID'] }) error: 'LINK_INVALID';
  @ApiProperty() message: string;
}

/** O casamento ainda não tem endereço (Pré-visualização RN01). */
export class SiteSlugMissingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SITE_SLUG_MISSING'] }) error: 'SITE_SLUG_MISSING';
  @ApiProperty() message: string;
}

/** O grupo não é do casamento ou está na lixeira (Pré-visualização RN09). */
export class SitePartyNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PARTY_NOT_FOUND'] }) error: 'PARTY_NOT_FOUND';
  @ApiProperty() message: string;
}

/** "Esta prévia não vale mais." (Pré-visualização RN04). */
export class PreviewInvalidErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PREVIEW_INVALID'] }) error: 'PREVIEW_INVALID';
  @ApiProperty() message: string;
}

/** Sem cookie da prévia válido (Pré-visualização RN05 e RN06). */
export class PreviewRequiredErrorBody {
  static readonly status = 401;
  @ApiProperty({ enum: [401] }) statusCode: 401;
  @ApiProperty({ enum: ['PREVIEW_REQUIRED'] }) error: 'PREVIEW_REQUIRED';
  @ApiProperty() message: string;
}
