import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { OptionalSession, Public } from '../../../shared/http/public.decorator';
import { AcceptAccessInvitation } from '../application/accept-access-invitation.use-case';
import { DeclineAccessInvitation } from '../application/decline-access-invitation.use-case';
import { GetAccessInvitation } from '../application/get-access-invitation.use-case';
import type { AuthenticatedSession } from '../domain/authenticated-session';
import {
  AlreadyMemberErrorBody,
  SelfReferralErrorBody,
  PlannerProfileExistsErrorBody,
  AlreadyOwnerErrorBody,
  EmailMismatchErrorBody,
  InvitationInvalidErrorBody,
  InvitationNotDeclinableErrorBody,
  OwnersFullErrorBody,
  PlannerAlreadyErrorBody,
  SellerCannotBePlannerErrorBody,
} from './access-error.dto';
import { toHttpError } from './access-http-errors';
import type { AuthenticatedRequest } from './authenticated-request';
import { CurrentSession } from './current-session.decorator';
import {
  AcceptAccessInvitationBody,
  AcceptAccessInvitationResponse,
  AccessInvitationResponse,
} from './invitation-acceptance.dto';

@ApiTags('access-invitations')
@Controller('access-invitations/:token')
export class InvitationAcceptanceController {
  constructor(
    private readonly getInvitation: GetAccessInvitation,
    private readonly acceptInvitation: AcceptAccessInvitation,
    private readonly declineInvitation: DeclineAccessInvitation,
  ) {}

  /** Mostra o casamento e quem convidou antes do aceite (RN06, RN07, RN12 de Convites). */
  @Get()
  @Public()
  @OptionalSession()
  @ApiErrorResponses(...commonErrors({}), InvitationInvalidErrorBody)
  async read(
    @Param('token') token: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccessInvitationResponse> {
    try {
      const view = await this.getInvitation.execute({
        token,
        sessionUserId: request.auth?.userId ?? null,
        now: new Date(),
      });
      return AccessInvitationResponse.from({ view });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Aceita com a conta da sessão (RN07 a RN10, RN14 de Convites; decisões 168 e 172). */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    EmailMismatchErrorBody,
    AlreadyOwnerErrorBody,
    AlreadyMemberErrorBody,
    OwnersFullErrorBody,
    PlannerAlreadyErrorBody,
    SellerCannotBePlannerErrorBody,
    SelfReferralErrorBody,
    PlannerProfileExistsErrorBody,
    InvitationInvalidErrorBody,
  )
  async accept(
    @CurrentSession() session: AuthenticatedSession,
    @Param('token') token: string,
    @Body() body: AcceptAccessInvitationBody,
  ): Promise<AcceptAccessInvitationResponse> {
    try {
      const accepted = await this.acceptInvitation.execute({
        token,
        userId: session.userId,
        sessionId: session.sessionId,
        now: new Date(),
        acceptance: {
          confirmOtherAccount: body.confirmOtherAccount ?? false,
          partnerIndex: body.partnerIndex ?? null,
          myTitle: body.myTitle ?? null,
          name: body.name ?? null,
        },
      });
      return AcceptAccessInvitationResponse.from({ accepted });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Recusa sem login: o link é a credencial (RN11; decisão 136). */
  @Post('decline')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiErrorResponses(
    ...commonErrors({ write: true }),
    InvitationInvalidErrorBody,
    InvitationNotDeclinableErrorBody,
  )
  async decline(@Param('token') token: string): Promise<void> {
    try {
      await this.declineInvitation.execute({ token, now: new Date() });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
