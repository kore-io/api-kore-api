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
