import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AppConfigService } from '../../../shared/config/app-config.service';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { Public } from '../../../shared/http/public.decorator';
import { SiteRoute } from '../../../shared/http/site-route.decorator';
import { SimulatorEventRateLimitGuard } from '../../../shared/rate-limit/simulator-event-rate-limit.guard';
import {
  PRODUCT_EVENT_RECORDER,
  type ProductEventRecorder,
} from '../application/ports/product-event-recorder.port';
import { SIMULATOR_EVENT_NAMES, type SimulatorEventName } from '../domain/product-event';

export class SimulatorEventBody {
  /** Só estes nomes, e nada mais (Simule RN11; decisão 205, D26). */
  @ApiProperty({ enum: SIMULATOR_EVENT_NAMES })
  @IsIn(SIMULATOR_EVENT_NAMES)
  name: SimulatorEventName;
}

/**
 * As métricas anônimas do funil do Simule o site (Simule RN11), gravadas pelo
 * bundle público. Rota do site, pública: o cookie de sessão é ignorado, e o
 * evento não leva casamento, props nem IP. Desligada (SIMULATOR_ENABLED), 404.
 */
@ApiTags('product-events')
@Controller('product-events')
@SiteRoute()
@Public()
export class SimulatorEventsController {
  private readonly enabled: boolean;

  constructor(
    @Inject(PRODUCT_EVENT_RECORDER) private readonly recorder: ProductEventRecorder,
    config: AppConfigService,
  ) {
    this.enabled = config.get({ key: 'SIMULATOR_ENABLED' });
  }

  @Post('simulator')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SimulatorEventRateLimitGuard)
  @ApiErrorResponses(...commonErrors({ validated: true, write: true }))
  async record(@Body() body: SimulatorEventBody): Promise<void> {
    // Fora de local e test, até o PO liberar a publicação (Simule RN01).
    if (!this.enabled) throw new NotFoundException();
    await this.recorder.record({ event: { name: body.name }, occurredAt: new Date() });
  }
}
