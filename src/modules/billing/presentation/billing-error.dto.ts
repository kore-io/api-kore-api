import { ApiProperty } from '@nestjs/swagger';

/** Extensão de casamento que nunca publicou (Preço e cotação RN04). */
export class NotPublishedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['NOT_PUBLISHED'] }) error: 'NOT_PUBLISHED';
  @ApiProperty() message: string;
}

/** Parcelas fora de 1 a maxInstallments (Preço e cotação RN01; B1-2). */
export class InstallmentsOutOfRangeErrorBody {
  static readonly status = 400;
  @ApiProperty({ enum: [400] }) statusCode: 400;
  @ApiProperty({ enum: ['INSTALLMENTS_OUT_OF_RANGE'] }) error: 'INSTALLMENTS_OUT_OF_RANGE';
  @ApiProperty() message: string;
  @ApiProperty({ example: 5 }) maxInstallments: number;
}
