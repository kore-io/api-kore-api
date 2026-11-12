import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { GetDeliveryQueue, MarkDeliveries } from '../application/deliveries.use-cases';
import {
  DeliveriesClosedErrorBody,
  DeliveryNotAllowedErrorBody,
  DeliveryPartyNotFoundErrorBody,
  DeliveryQueueQuery,
  DeliveryQueueResponse,
  MarkDeliveriesBody,
  MarkDeliveriesResponse,
} from './deliveries.dto';
import { toHttpError } from './rsvp-http-errors';

/** Envios de convite, save the date e lembrete pelos canais do casal (F4). */
@ApiTags('rsvp')
@Controller('weddings/:weddingId/deliveries')
export class DeliveriesController {
  constructor(
    private readonly queue: GetDeliveryQueue,
    private readonly markDeliveries: MarkDeliveries,
  ) {}

  /** A fila de envio, com as URLs prontas e o contato inteiro só nelas (RN07 e RN11). */
  @Get('queue')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    DeliveriesClosedErrorBody,
  )
  async getQueue(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Query() query: DeliveryQueueQuery,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DeliveryQueueResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      return DeliveryQueueResponse.from({
        queue: await this.queue.execute({
          userId: session.userId,
          weddingId,
          kind: query.kind,
          partyIds: query.partyIds,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Marca o envio dos grupos (o clique no canal; RN07 e RN08). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    DeliveriesClosedErrorBody,
    DeliveryPartyNotFoundErrorBody,
    DeliveryNotAllowedErrorBody,
  )
  async mark(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: MarkDeliveriesBody,
  ): Promise<MarkDeliveriesResponse> {
    try {
      return MarkDeliveriesResponse.from({
        parties: await this.markDeliveries.execute({
          userId: session.userId,
          weddingId,
          partyIds: body.partyIds,
          kind: body.kind,
          channel: body.channel,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
