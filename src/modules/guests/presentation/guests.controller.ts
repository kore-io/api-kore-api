import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
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
import { MoveGuest } from '../application/move-guest.use-case';
import { GuestNotFoundError } from '../domain/guests.errors';
import {
  EmptyPlusOneErrorBody,
  GuestNotFoundErrorBody,
  LastGuestErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import { MoveGuestBody, MoveGuestResponse } from './parties.dto';

@ApiTags('guests')
@Controller('weddings/:weddingId/guests')
export class GuestsController {
  constructor(private readonly moveGuest: MoveGuest) {}

  /** Mover de grupo: mantém a resposta e as tags (Grupos RN10). */
  @Post(':guestId/move')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    GuestNotFoundErrorBody,
    LastGuestErrorBody,
    EmptyPlusOneErrorBody,
  )
  async move(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'guestId',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new GuestNotFoundError()) }),
    )
    guestId: string,
    @Body() body: MoveGuestBody,
    @Req() request: Request,
  ): Promise<MoveGuestResponse> {
    try {
      return await this.moveGuest.execute({
        userId: session.userId,
        weddingId,
        guestId,
        toPartyId: body.partyId,
        ip: request.ip ?? null,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
