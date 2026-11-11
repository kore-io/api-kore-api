import {
  Body,
  Controller,
  Delete,
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
import { TrashGuest } from '../application/trash.use-cases';
import { TrashedGuestResponse } from './trash.dto';
import { GuestNotFoundError } from '../domain/guests.errors';
import {
  AlreadyRespondedErrorBody,
  EmptyPlusOneErrorBody,
  GuestNotFoundErrorBody,
  LastGuestErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import { MoveGuestBody, MoveGuestResponse } from './parties.dto';

@ApiTags('guests')
@Controller('weddings/:weddingId/guests')
export class GuestsController {
  constructor(
    private readonly moveGuest: MoveGuest,
    private readonly trashGuest: TrashGuest,
  ) {}

  /** Mover o convidado para a lixeira (Lixeira RN04 e RN07). */
  @Delete(':guestId')
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    AlreadyRespondedErrorBody,
    WeddingNotFoundErrorBody,
    GuestNotFoundErrorBody,
    LastGuestErrorBody,
    EmptyPlusOneErrorBody,
  )
  async trash(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'guestId',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new GuestNotFoundError()) }),
    )
    guestId: string,
    @Req() request: Request,
  ): Promise<TrashedGuestResponse> {
    try {
      const guest = await this.trashGuest.execute({
        userId: session.userId,
        weddingId,
        guestId,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { ...guest, deletedAt: guest.deletedAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }

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
