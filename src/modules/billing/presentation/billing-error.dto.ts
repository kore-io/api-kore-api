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

/** O pendente trocado já estava pago; o Kore o aplicou (RN07; B2-4). */
export class PaymentAlreadyPaidErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYMENT_ALREADY_PAID'] }) error: 'PAYMENT_ALREADY_PAID';
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

/** O pagamento não é deste casamento (Pagamentos e arrependimento). */
export class PaymentNotFoundErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty({ enum: ['PAYMENT_NOT_FOUND'] }) error: 'PAYMENT_NOT_FOUND';
  @ApiProperty() message: string;
}

/** Casamento bloqueado: o app não desiste (RN02; decisão 83). */
export class WeddingBlockedErrorBody {
  static readonly status = 403;
  @ApiProperty({ enum: [403] }) statusCode: 403;
  @ApiProperty({ enum: ['WEDDING_BLOCKED'] }) error: 'WEDDING_BLOCKED';
  @ApiProperty() message: string;
}

/** Só o pagamento pago e aplicado tem Desistir. */
export class PaymentNotPaidErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYMENT_NOT_PAID'] }) error: 'PAYMENT_NOT_PAID';
  @ApiProperty() message: string;
}

/** Em contestação, sem Desistir (RN02). */
export class PaymentDisputedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['PAYMENT_DISPUTED'] }) error: 'PAYMENT_DISPUTED';
  @ApiProperty() message: string;
}

/** O reembolso deste pagamento já foi pedido (RN04). */
export class RefundAlreadyRequestedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFUND_ALREADY_REQUESTED'] }) error: 'REFUND_ALREADY_REQUESTED';
  @ApiProperty() message: string;
}

/** Há uma extensão (ou cortesia) mais recente (RN03). */
export class RefundNotLastExtensionErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFUND_NOT_LAST_EXTENSION'] }) error: 'REFUND_NOT_LAST_EXTENSION';
  @ApiProperty() message: string;
}

/** O prazo de 7 dias terminou (RN02), com o último instante dele. */
export class RefundWindowClosedErrorBody {
  static readonly status = 409;
  @ApiProperty({ enum: [409] }) statusCode: 409;
  @ApiProperty({ enum: ['REFUND_WINDOW_CLOSED'] }) error: 'REFUND_WINDOW_CLOSED';
  @ApiProperty() message: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) refundableUntil:
    string | null;
}
