import { ApiProperty } from '@nestjs/swagger';

/** Erros de regra do contexto Site, no formato nativo (decisão 99). */

/** "Muitas fotos foram trocadas neste site hoje. Tentem de novo amanhã." (S4 RN07). */
export class SiteImageLimitErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['SITE_IMAGE_LIMIT'] }) error: 'SITE_IMAGE_LIMIT';
  @ApiProperty() message: string;
}
