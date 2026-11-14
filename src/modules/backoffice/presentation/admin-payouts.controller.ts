import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { requireRecentSession } from '../../access/domain/recent-session';
import {
  ActionNotAllowedErrorBody,
  ReauthRequiredErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import {
  ListPayoutQueue,
  RejectPayout,
  ReleasePayout,
} from '../../billing/application/payouts/payout-admin.use-cases';
import {
  PayPayout,
  RetryPayout,
} from '../../billing/application/payouts/payout-transfers.use-cases';
import type { StaffMember } from '../domain/staff';
import { AdminReasonBody } from './admin-weddings.dto';
import { AdminPayoutsQuery, AdminPayoutsResponse, PayoutActionResponse } from './admin-payouts.dto';
import { StaffOnlyErrorBody } from './backoffice-error.dto';
import { toHttpError } from './backoffice-http-errors';
import { CurrentStaff, StaffGuard, StaffRoles } from './staff.guard';

const payoutIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
});

/**
 * A fila de Repasses (Backoffice - cobrança RN09): só o Admin. O Pagar pede
 * sessão recente (RN01; B10-1) e o Pix sai depois do commit, por job (G1).
 */
@ApiTags('admin')
@Controller('admin/payouts')
@UseGuards(StaffGuard)
@StaffRoles('admin')
export class AdminPayoutsController {
  constructor(
    private readonly queue: ListPayoutQueue,
    private readonly pay: PayPayout,
    private readonly retry: RetryPayout,
    private readonly reject: RejectPayout,
    private readonly release: ReleasePayout,
  ) {}

  @Get()
  @OwnTransactions()
  @ApiOkResponse({ type: AdminPayoutsResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async list(@Query() query: AdminPayoutsQuery): Promise<AdminPayoutsResponse> {
    const page = query.page ?? 1;
    const result = await this.queue.execute({
      tab: query.tab ?? 'requested',
      referrerId: query.referrerId,
      page,
    });
    return AdminPayoutsResponse.from({ page, result });
  }

  /** Pagar (RN09; Repasse RN05): confere tudo na transação e manda o Pix por job. */
  @Post(':id/pay')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PayoutActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReauthRequiredErrorBody,
  )
  async payPayout(
    @CurrentStaff() staff: StaffMember,
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', payoutIdPipe) payoutId: string,
  ): Promise<PayoutActionResponse> {
    try {
      const now = new Date();
      requireRecentSession({ session, now });
      await this.pay.execute({ payoutId, adminUserId: staff.userId, now });
      return { status: 'processing' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Tentar o Pix de novo (RN09): consulta o gateway antes; não achou, manda de novo. */
  @Post(':id/retry')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PayoutActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async retryPayout(@Param('id', payoutIdPipe) payoutId: string): Promise<PayoutActionResponse> {
    try {
      return { status: await this.retry.execute({ payoutId, now: new Date() }) };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Recusar (RN09), com motivo. */
  @Post(':id/reject')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PayoutActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async rejectPayout(
    @CurrentStaff() staff: StaffMember,
    @Param('id', payoutIdPipe) payoutId: string,
    @Body() body: AdminReasonBody,
  ): Promise<PayoutActionResponse> {
    try {
      await this.reject.execute({
        payoutId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'rejected' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Liberar o retido (RN09). */
  @Post(':id/release')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PayoutActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async releasePayout(
    @CurrentStaff() staff: StaffMember,
    @Param('id', payoutIdPipe) payoutId: string,
  ): Promise<PayoutActionResponse> {
    try {
      const { amountCents } = await this.release.execute({
        payoutId,
        adminUserId: staff.userId,
        now: new Date(),
      });
      return { status: 'requested', amountCents };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
