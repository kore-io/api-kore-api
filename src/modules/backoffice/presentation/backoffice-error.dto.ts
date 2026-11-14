import { ApiProperty } from '@nestjs/swagger';

/** Fora do staff (Backoffice - acesso RN01): sem dizer qual dos motivos. */
export class StaffOnlyErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['STAFF_ONLY'] }) error: 'STAFF_ONLY';
  @ApiProperty() message: string;
}

export class AlreadyBlockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALREADY_BLOCKED'] }) error: 'ALREADY_BLOCKED';
  @ApiProperty() message: string;
}

export class NotBlockedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOT_BLOCKED'] }) error: 'NOT_BLOCKED';
  @ApiProperty() message: string;
}

export class AlertNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['ALERT_NOT_FOUND'] }) error: 'ALERT_NOT_FOUND';
  @ApiProperty() message: string;
}

export class AlertAlreadyResolvedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['ALERT_ALREADY_RESOLVED'] }) error: 'ALERT_ALREADY_RESOLVED';
  @ApiProperty() message: string;
}
