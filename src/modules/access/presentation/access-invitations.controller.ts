import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { CancelAccessInvitation } from '../application/cancel-access-invitation.use-case';
import { SendAccessInvitations } from '../application/send-access-invitations.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import { InvitationNotFoundError } from '../domain/access.errors';
import {
  ActionNotAllowedErrorBody,
  CoupleInvitationsFullErrorBody,
  InvitationNotFoundErrorBody,
  NotPendingErrorBody,
  OwnersFullErrorBody,
  PlannerAlreadyErrorBody,
  WeddingNotFoundErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import { SendAccessInvitationsBody, SendAccessInvitationsResponse } from './access-invitations.dto';
import { CurrentSession } from './current-session.decorator';

@ApiTags('access-invitations')
@Controller('weddings/:weddingId/access-invitations')
export class AccessInvitationsController {
  constructor(
    private readonly sendInvitations: SendAccessInvitations,
    private readonly cancelInvitation: CancelAccessInvitation,
  ) {}

  /** Envia ou reenvia convites de acesso, ou gera o link do casal (RN01 a RN04, RN14 de Convites). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    OwnersFullErrorBody,
    PlannerAlreadyErrorBody,
    CoupleInvitationsFullErrorBody,
  )
  async send(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: SendAccessInvitationsBody,
  ): Promise<SendAccessInvitationsResponse> {
    try {
      const invitations = await this.sendInvitations.execute({
        userId: session.userId,
        weddingId,
        kind: body.kind,
        emails: body.emails ?? [],
        message: body.message ?? null,
        now: new Date(),
      });
      return SendAccessInvitationsResponse.from({ invitations });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Cancela um convite pendente (RN05 de Convites). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    InvitationNotFoundErrorBody,
    NotPendingErrorBody,
  )
  async cancel(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'id',
      new ParseUUIDPipe({ exceptionFactory: () => toHttpError(new InvitationNotFoundError()) }),
    )
    invitationId: string,
  ): Promise<void> {
    try {
      await this.cancelInvitation.execute({
        userId: session.userId,
        weddingId,
        invitationId,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
