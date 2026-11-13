import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { OptionalNotNull } from '../../../shared/http/optional-not-null';
import { Public } from '../../../shared/http/public.decorator';
import { DEV_PAYMENT_EVENTS, type DevPaymentEvent } from '../application/dev-payment-events';
import { EmitDevPaymentEvent } from '../application/emit-dev-payment-event.use-case';

export class DevPaymentEventBody {
  /** O total que o gateway diz ter cobrado (valor diferente, RN09). */
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  amountCents?: number;

  /** Quantas vezes o mesmo evento chega (webhook repetido, RN09). */
  @OptionalNotNull()
  @IsInt()
  @Min(1)
  @Max(5)
  repeat?: number;

  /** A próxima chamada à porta não responde (B2-15). */
  @OptionalNotNull()
  @IsBoolean()
  failNextGatewayCall?: boolean;
}

/**
 * Rota dev de pagamentos (Publicar e pagar RN15): só em local e test. O módulo
 * dela nem é registrado fora deles (ConditionalModule), e ela fica fora do
 * openapi.json. Sem sessão: serve ao E2E, ao Bruno e às sessões locais.
 */
@ApiExcludeController()
@Controller('dev/payments')
@Public()
export class DevPaymentsController {
  constructor(private readonly emit: EmitDevPaymentEvent) {}

  @Post(':id/:event')
  @HttpCode(HttpStatus.OK)
  async emitEvent(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('event') event: string,
    @Body() body: DevPaymentEventBody,
  ): Promise<{ gatewayEventId: string; deliveries: number }> {
    if (!(DEV_PAYMENT_EVENTS as readonly string[]).includes(event)) throw new NotFoundException();
    const result = await this.emit.execute({
      id,
      event: event as DevPaymentEvent,
      ...body,
      now: new Date(),
    });
    if (result.kind === 'not_found') throw new NotFoundException();
    return { gatewayEventId: result.gatewayEventId, deliveries: result.deliveries };
  }
}
