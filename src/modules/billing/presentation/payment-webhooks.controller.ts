import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Public } from '../../../shared/http/public.decorator';
import { PaymentWebhookRateLimitGuard } from '../../../shared/rate-limit/payment-webhook-rate-limit.guard';
import { GENERAL_THROTTLER } from '../../../shared/rate-limit/rate-limits';
import { ReceiveGatewayWebhook } from '../application/receive-gateway-webhook.use-case';

export class WebhookReceivedResponse {
  @ApiProperty({ enum: [true] }) received: true;
}

export class InvalidSignatureErrorBody {
  static readonly status = 401;
  @ApiProperty({ enum: [401] }) statusCode: 401;
  @ApiProperty({ enum: ['INVALID_SIGNATURE'] }) error: 'INVALID_SIGNATURE';
  @ApiProperty() message: string;
}

export class MalformedWebhookErrorBody {
  static readonly status = 400;
  @ApiProperty({ enum: [400] }) statusCode: 400;
  @ApiProperty({ enum: ['MALFORMED_EVENT'] }) error: 'MALFORMED_EVENT';
  @ApiProperty() message: string;
}

export class UnknownGatewayErrorBody {
  static readonly status = 404;
  @ApiProperty({ enum: [404] }) statusCode: 404;
  @ApiProperty() message: string;
}

/**
 * O webhook do gateway (Publicar e pagar RN09; POST /v1/webhooks/payments/{gateway}):
 * sem sessão, com assinatura conferida antes de tudo e corpo bruto. Fica fora
 * do OriginGuard na prática (o gateway não manda Origin nem cookie) e do limite
 * geral, com limite próprio (B2-6). O 200 só sai depois de gravar o evento; se
 * o banco falhar, o 5xx faz o gateway reenviar.
 */
@ApiTags('billing')
@Controller('webhooks/payments')
@Public()
export class PaymentWebhooksController {
  constructor(private readonly receive: ReceiveGatewayWebhook) {}

  @Post(':gateway')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle({ [GENERAL_THROTTLER]: true })
  @UseGuards(PaymentWebhookRateLimitGuard)
  @ApiOkResponse({ type: WebhookReceivedResponse })
  @ApiErrorResponses(
    ...commonErrors({}),
    MalformedWebhookErrorBody,
    InvalidSignatureErrorBody,
    UnknownGatewayErrorBody,
  )
  async receiveEvent(
    @Param('gateway') gateway: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<WebhookReceivedResponse> {
    const receipt = await this.receive.execute({
      gateway,
      headers: request.headers,
      rawBody: request.rawBody ?? Buffer.alloc(0),
      now: new Date(),
    });
    if (receipt.kind === 'unknown_gateway') throw new NotFoundException();
    if (receipt.kind === 'invalid_signature') {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'INVALID_SIGNATURE',
        message: 'Invalid webhook signature.',
      });
    }
    if (receipt.kind === 'malformed') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'MALFORMED_EVENT',
        message: 'The event could not be read.',
      });
    }
    return { received: true };
  }
}
