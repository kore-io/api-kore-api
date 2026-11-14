import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import { AdminWeddings } from '../application/admin-weddings.use-cases';
import { ReassignReferrer } from '../application/reassign-referrer.use-case';
import { EraseGuestOnRequest } from '../application/erase-guest.use-case';
import { ChangeAccessEmail } from '../application/change-access-email.use-cases';
import type { StaffMember } from '../domain/staff';
import {
  AccessChangeRateLimitedErrorBody,
  AccessEmailLockedErrorBody,
  ChecksFailedErrorBody,
  ChecksRequiredErrorBody,
  EmailInUseErrorBody,
  NotLockedErrorBody,
  UnlockTooSoonErrorBody,
  GuestNotFoundErrorBody,
  AlreadyPaidErrorBody,
  ReassignPaymentPendingErrorBody,
  ReferrerNotActiveErrorBody,
  SelfReferralErrorBody,
  AlreadyBlockedErrorBody,
  NotBlockedErrorBody,
  StaffOnlyErrorBody,
} from './backoffice-error.dto';
import { toHttpError } from './backoffice-http-errors';
import {
  AdminBlockStateResponse,
  AdminReasonBody,
  AdminWeddingDetailResponse,
  AdminWeddingQuery,
  AdminWeddingsQuery,
  AdminWeddingsResponse,
  ReassignReferrerBody,
  EraseGuestBody,
  AccessEmailChangedResponse,
  AccessEmailUnlockedResponse,
  ChangeAccessEmailBody,
  GuestErasedResponse,
  ReassignReferrerResponse,
} from './admin-weddings.dto';
import { CurrentStaff, StaffGuard, StaffRoles } from './staff.guard';

const weddingIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
});

/**
 * Casamentos do Backoffice (Backoffice - acesso RN05 e RN06), para o Admin e
 * o suporte. Pela conexão do backoffice (decisão 180(5)): fora da transação
 * da requisição.
 */
@ApiTags('admin')
@Controller('admin/weddings')
@UseGuards(StaffGuard)
export class AdminWeddingsController {
  constructor(
    private readonly weddings: AdminWeddings,
    private readonly reassignReferrer: ReassignReferrer,
    private readonly eraseGuest: EraseGuestOnRequest,
    private readonly accessEmail: ChangeAccessEmail,
  ) {}

  @Get()
  @OwnTransactions()
  @ApiOkResponse({ type: AdminWeddingsResponse })
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), StaffOnlyErrorBody)
  async list(@Query() query: AdminWeddingsQuery): Promise<AdminWeddingsResponse> {
    const page = await this.weddings.list({ query: { ...query, page: query.page ?? 1 } });
    return AdminWeddingsResponse.from({ page });
  }

  @Get(':id')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminWeddingDetailResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    WeddingNotFoundErrorBody,
  )
  async detail(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Query() query: AdminWeddingQuery,
    @Req() request: Request,
  ): Promise<AdminWeddingDetailResponse> {
    try {
      const detail = await this.weddings.detail({
        staff,
        weddingId,
        tab: query.tab ?? 'general',
        page: query.page ?? 1,
        ip: request.ip ?? null,
      });
      return AdminWeddingDetailResponse.from({ detail });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Bloquear (RN05; Casamento bloqueado RN01): Admin e suporte, com o motivo. */
  @Post(':id/block')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminBlockStateResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    AlreadyBlockedErrorBody,
  )
  async block(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Body() body: AdminReasonBody,
    @Req() request: Request,
  ): Promise<AdminBlockStateResponse> {
    try {
      await this.weddings.block({
        staff,
        weddingId,
        reason: body.reason,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { blocked: true };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Desbloquear (RN05): o mesmo Dialog, com o motivo. */
  @Post(':id/unblock')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminBlockStateResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    NotBlockedErrorBody,
  )
  async unblock(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Body() body: AdminReasonBody,
    @Req() request: Request,
  ): Promise<AdminBlockStateResponse> {
    try {
      await this.weddings.unblock({
        staff,
        weddingId,
        reason: body.reason,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { blocked: false };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Reatribuir o indicador (RN07): só o Admin, antes da publicação paga e sem pendente. */
  @Put(':id/referrer')
  @OwnTransactions()
  @StaffRoles('admin')
  @ApiOkResponse({ type: ReassignReferrerResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    AlreadyPaidErrorBody,
    ReassignPaymentPendingErrorBody,
    ReferrerNotActiveErrorBody,
    SelfReferralErrorBody,
  )
  async referrer(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Body() body: ReassignReferrerBody,
    @Req() request: Request,
  ): Promise<ReassignReferrerResponse> {
    try {
      const status = await this.reassignReferrer.execute({
        staff,
        weddingId,
        referrerId: body.referrerId,
        reason: body.reason,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { status };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Remover os dados de um convidado a pedido do titular (RN10): Admin e suporte. */
  @Post(':id/guests/:guestId/erase')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: GuestErasedResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    GuestNotFoundErrorBody,
  )
  async erase(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Param(
      'guestId',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          validationError({ errors: [{ path: 'guestId', code: 'IS_UUID', params: {} }] }),
      }),
    )
    guestId: string,
    @Body() body: EraseGuestBody,
    @Req() request: Request,
  ): Promise<GuestErasedResponse> {
    try {
      await this.eraseGuest.execute({
        staff,
        weddingId,
        guestId,
        requestChannel: body.requestChannel,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { status: 'erased' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Ajudar a recuperar o acesso (RN09; decisão 253): Admin e suporte. */
  @Put(':id/access-email')
  @OwnTransactions()
  @ApiOkResponse({ type: AccessEmailChangedResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    ChecksRequiredErrorBody,
    ChecksFailedErrorBody,
    EmailInUseErrorBody,
    AccessEmailLockedErrorBody,
    AccessChangeRateLimitedErrorBody,
  )
  async changeAccessEmail(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Body() body: ChangeAccessEmailBody,
    @Req() request: Request,
  ): Promise<AccessEmailChangedResponse> {
    try {
      await this.accessEmail.execute({
        staff,
        weddingId,
        userId: body.userId,
        newEmail: body.newEmail,
        checks: body.checks,
        payerLast4: body.payerLast4 ?? null,
        reason: body.reason,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { status: 'changed' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Liberar a trava da troca do e-mail de acesso (decisão 253(1)): só o Admin. */
  @Post(':id/access-email/unlock')
  @OwnTransactions()
  @StaffRoles('admin')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AccessEmailUnlockedResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    NotLockedErrorBody,
    UnlockTooSoonErrorBody,
  )
  async unlockAccessEmail(
    @CurrentStaff() staff: StaffMember,
    @Param('id', weddingIdPipe) weddingId: string,
    @Body() body: AdminReasonBody,
    @Req() request: Request,
  ): Promise<AccessEmailUnlockedResponse> {
    try {
      await this.accessEmail.unlock({
        staff,
        weddingId,
        reason: body.reason,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return { status: 'unlocked' };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
