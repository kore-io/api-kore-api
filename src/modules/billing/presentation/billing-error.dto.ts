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

export class PaymentPendingErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYMENT_PENDING'] }) error: 'PAYMENT_PENDING';
  @ApiProperty() message: string;
}

export class RefundInProgressErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFUND_IN_PROGRESS'] }) error: 'REFUND_IN_PROGRESS';
  @ApiProperty() message: string;
}

export class PriceChangedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PRICE_CHANGED'] }) error: 'PRICE_CHANGED';
  @ApiProperty() message: string;
}

export class IdempotencyKeyReusedErrorBody {
  static readonly status = 422;
  @ApiProperty({ enum: [422] }) statusCode: 422;
  @ApiProperty({ enum: ['IDEMPOTENCY_KEY_REUSED'] }) error: 'IDEMPOTENCY_KEY_REUSED';
  @ApiProperty() message: string;
}

/** Sem Idempotency-Key, ou fora do formato UUID (B2-10). */
export class IdempotencyKeyRequiredErrorBody {
  static readonly status = 400;
  @ApiProperty({ enum: [400] }) statusCode: 400;
  @ApiProperty({ enum: ['IDEMPOTENCY_KEY_REQUIRED'] }) error: 'IDEMPOTENCY_KEY_REQUIRED';
  @ApiProperty() message: string;
}

/** O gateway não respondeu; o pagamento ficou pendente (RN03, RN11). */
export class GatewayUnavailableErrorBody {
  static readonly status = 503;
  @ApiProperty({ enum: [503] }) statusCode: 503;
  @ApiProperty({ enum: ['GATEWAY_UNAVAILABLE'] }) error: 'GATEWAY_UNAVAILABLE';
  @ApiProperty() message: string;
  @ApiProperty({ format: 'uuid' }) paymentId: string;
}
