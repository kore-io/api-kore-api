import { ApiProperty } from '@nestjs/swagger';

/**
 * Corpos de erro transversais, no formato nativo do NestJS com o código no
 * campo error (decisão 99). Documentados no OpenAPI para o Orval tipar os
 * erros no app (decisão 149). Cada classe guarda o status em `status`.
 */
export class ValidationErrorBody {
  static readonly status = 400;
  @ApiProperty({ enum: [400] }) statusCode: 400;
  @ApiProperty({ enum: ['Bad Request'] }) error: 'Bad Request';
  /** Um texto por campo inválido. */
  @ApiProperty({ type: [String] }) message: string[];
}

export class SessionExpiredErrorBody {
  static readonly status = 401;
  @ApiProperty({ enum: [401] }) statusCode: 401;
  @ApiProperty({ enum: ['SESSION_EXPIRED'] }) error: 'SESSION_EXPIRED';
  @ApiProperty() message: string;
}

export class OriginNotAllowedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['ORIGIN_NOT_ALLOWED'] }) error: 'ORIGIN_NOT_ALLOWED';
  @ApiProperty() message: string;
}

export class RateLimitedErrorBody {
  static readonly status = 429;
  @ApiProperty({ enum: [429] }) statusCode: 429;
  @ApiProperty({ enum: ['RATE_LIMITED'] }) error: 'RATE_LIMITED';
  @ApiProperty() message: string;
}
