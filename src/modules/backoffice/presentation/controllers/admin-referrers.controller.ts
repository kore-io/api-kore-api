import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { validationError } from '@/shared/http/validation-errors';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  ReauthRequiredErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { OwnTransactions } from '@/modules/access/presentation/http/decorators/own-transactions.decorator';
import { TaxIdInUseErrorBody } from '@/modules/referral/presentation/dto/payout-data.dto';
import { ReferrerAdminActions } from '@/modules/backoffice/application/referrer-admin.use-cases';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import {
  AdjustmentBody,
  AdjustmentResponse,
  CommissionBlockResponse,
  CommissionUnblockResponse,
  CorrectTaxIdBody,
  CorrectTaxIdResponse,
  ReferrerBlockResponse,
  ReferrerUnblockResponse,
} from '@/modules/backoffice/presentation/dto/admin-referrers.dto';
import { AdminReasonBody } from '@/modules/backoffice/presentation/dto/admin-weddings.dto';
import {
  AlreadyBlockedErrorBody,
  CommissionNotBlockableErrorBody,
  CommissionNotFoundErrorBody,
  NotBlockedErrorBody,
  ReferrerNotFoundErrorBody,
  StaffOnlyErrorBody,
} from '@/modules/backoffice/presentation/dto/backoffice-error.dto';
import { toHttpError } from '@/modules/backoffice/presentation/errors/backoffice-http-errors';
import {
  CurrentStaff,
  StaffGuard,
  StaffRoles,
} from '@/modules/backoffice/presentation/http/guards/staff.guard';

const idPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
});

/** As ações do Admin na cerimonialista (Backoffice - cobrança RN08). */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
@StaffRoles('admin')
export class AdminReferrersController {
  constructor(private readonly actions: ReferrerAdminActions) {}

  /** Bloquear a cerimonialista (decisão 68; 230 D15), com motivo. */
  @Post('referrers/:id/block')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ReferrerBlockResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReferrerNotFoundErrorBody,
    AlreadyBlockedErrorBody,
  )
  async block(
    @CurrentStaff() staff: StaffMember,
    @Param('id', idPipe) referrerId: string,
    @Body() body: AdminReasonBody,
  ): Promise<ReferrerBlockResponse> {
    try {
      const { heldPayoutIds } = await this.actions.blockReferrer({
        referrerId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'blocked', heldPayoutIds };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Desbloquear: as comissões bloqueadas continuam bloqueadas. */
  @Post('referrers/:id/unblock')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: ReferrerUnblockResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReferrerNotFoundErrorBody,
    NotBlockedErrorBody,
  )
  async unblock(
    @CurrentStaff() staff: StaffMember,
    @Param('id', idPipe) referrerId: string,
    @Body() body: AdminReasonBody,
  ): Promise<ReferrerUnblockResponse> {
    try {
      await this.actions.unblockReferrer({
        referrerId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'active' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Corrigir CPF ou CNPJ (decisão 74): sessão recente; 409 TAX_ID_IN_USE. */
  @Put('referrers/:id/document')
  @OwnTransactions()
  @ApiOkResponse({ type: CorrectTaxIdResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReauthRequiredErrorBody,
    ReferrerNotFoundErrorBody,
    TaxIdInUseErrorBody,
  )
  async correctTaxId(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', idPipe) referrerId: string,
    @Body() body: CorrectTaxIdBody,
  ): Promise<CorrectTaxIdResponse> {
    try {
      return await this.actions.correctTaxId({
        session,
        referrerId,
        type: body.taxIdType,
        taxId: body.taxId,
        reason: body.reason,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Ajustar a comissão: o positivo pede sessão recente; acima de R$ 500,00 abre o alerta. */
  @Post('referrers/:id/adjustments')
  @OwnTransactions()
  @HttpCode(HttpStatus.CREATED)
  @ApiOkResponse({ type: AdjustmentResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReauthRequiredErrorBody,
    ReferrerNotFoundErrorBody,
  )
  async adjust(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', idPipe) referrerId: string,
    @Body() body: AdjustmentBody,
  ): Promise<AdjustmentResponse> {
    try {
      const { adjustmentId } = await this.actions.adjust({
        session,
        referrerId,
        amountCents: body.amountCents,
        reason: body.reason,
        now: new Date(),
      });
      return { id: adjustmentId };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Bloquear a comissão (B10-4): dentro de um repasse pedido, ele fica retido. */
  @Post('commissions/:id/block')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CommissionBlockResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    CommissionNotFoundErrorBody,
    CommissionNotBlockableErrorBody,
  )
  async blockCommission(
    @CurrentStaff() staff: StaffMember,
    @Param('id', idPipe) commissionId: string,
    @Body() body: AdminReasonBody,
  ): Promise<CommissionBlockResponse> {
    try {
      const { heldPayoutId } = await this.actions.blockCommission({
        commissionId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'blocked', heldPayoutId };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Desbloquear a comissão: sessão recente; volta ao prazo de liberação. */
  @Post('commissions/:id/unblock')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: CommissionUnblockResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReauthRequiredErrorBody,
    CommissionNotFoundErrorBody,
    CommissionNotBlockableErrorBody,
  )
  async unblockCommission(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', idPipe) commissionId: string,
    @Body() body: AdminReasonBody,
  ): Promise<CommissionUnblockResponse> {
    try {
      return await this.actions.unblockCommission({
        session,
        commissionId,
        reason: body.reason,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
