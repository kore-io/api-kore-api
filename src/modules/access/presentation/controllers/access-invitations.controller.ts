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
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { CancelAccessInvitation } from '@/modules/access/application/invitations/cancel-access-invitation.use-case';
import { SendAccessInvitations } from '@/modules/access/application/invitations/send-access-invitations.use-case';
import type { AuthenticatedSession } from '@/modules/access/domain/authenticated-session';
import { InvitationNotFoundError } from '@/modules/access/domain/access.errors';
import {
  ActionNotAllowedErrorBody,
  CoupleInvitationsFullErrorBody,
  InvitationNotFoundErrorBody,
  NotPendingErrorBody,
  OwnersFullErrorBody,
  PlannerAlreadyErrorBody,
  SelfInvitationErrorBody,
  WeddingNotFoundErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { toHttpError } from '@/modules/access/presentation/errors/access-http-errors';
import {
  SendAccessInvitationsBody,
  SendAccessInvitationsResponse,
} from '@/modules/access/presentation/dto/access-invitations.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';

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
    SelfInvitationErrorBody,
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
