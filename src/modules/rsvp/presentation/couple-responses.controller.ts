import { Body, Controller, Param, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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
import { GuestNotFoundErrorBody } from '../../guests/presentation/guests-error.dto';
import { ChangeGuestResponse, SetRsvpDeadline } from '../application/couple-responses.use-cases';
import {
  DeadlineAfterEventErrorBody,
  DeadlineInPastErrorBody,
  GuestResponseBody,
  GuestResponseChangedErrorBody,
  GuestResponseResponse,
  RsvpDeadlineBody,
  RsvpDeadlineResponse,
} from './couple-responses.dto';
import { toHttpError } from './rsvp-http-errors';

/** Prazo de resposta e respostas pelo casal (F4), na Área do Casal. */
@ApiTags('rsvp')
@Controller('weddings/:weddingId')
export class CoupleResponsesController {
  constructor(
    private readonly setDeadline: SetRsvpDeadline,
    private readonly changeResponse: ChangeGuestResponse,
  ) {}

  /** Define, muda, reabre ou tira o prazo de resposta (Prazo RN01 a RN03). */
  @Put('rsvp-deadline')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    DeadlineAfterEventErrorBody,
    DeadlineInPastErrorBody,
  )
  async deadline(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: RsvpDeadlineBody,
  ): Promise<RsvpDeadlineResponse> {
    try {
      return await this.setDeadline.execute({
        userId: session.userId,
        weddingId,
        rsvpDeadline: body.rsvpDeadline,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Alterar resposta pelo casal (Prazo RN04). */
  @Put('guests/:guestId/response')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    GuestNotFoundErrorBody,
    GuestResponseChangedErrorBody,
  )
  async response(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param('guestId') guestId: string,
    @Body() body: GuestResponseBody,
    @Req() request: Request,
  ): Promise<GuestResponseResponse> {
    try {
      return await this.changeResponse.execute({
        userId: session.userId,
        weddingId,
        guestId,
        version: body.version,
        answer: {
          status: body.status,
          dietaryRestriction: body.dietaryRestriction,
          name: body.name,
        },
        ip: request.ip ?? null,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
