import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import {
  PayoutAmountMismatchErrorBody,
  PayoutBelowMinimumAdminErrorBody,
  PayoutHeldErrorBody,
  PayoutNotFoundErrorBody,
  PayoutNotRequestedErrorBody,
  PayoutPixKeyChangePendingErrorBody,
  PayoutsDisabledAdminErrorBody,
  PayoutStatusConflictErrorBody,
  ReferrerBlockedErrorBody,
  StaffOnlyErrorBody,
} from './backoffice-error.dto';
import { IdempotencyKeyRequiredErrorBody } from '../../billing/presentation/billing-error.dto';
import { toHttpError } from './backoffice-http-errors';
import { CurrentStaff, StaffGuard, StaffRoles } from './staff.guard';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      tab: query.status ?? 'requested',
      referrerId: query.referrerId,
      page,
    });
    return AdminPayoutsResponse.from({ page, result });
  }

  /** Pagar (RN09; Repasse RN05): confere tudo na transação e manda o Pix por job. */
  @Post(':id/pay')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID (B2-10; decisão 259(3)).',
  })
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PayoutActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    IdempotencyKeyRequiredErrorBody,
    PayoutNotFoundErrorBody,
    PayoutNotRequestedErrorBody,
    PayoutHeldErrorBody,
    PayoutsDisabledAdminErrorBody,
    ReferrerBlockedErrorBody,
    PayoutPixKeyChangePendingErrorBody,
    PayoutAmountMismatchErrorBody,
    ReauthRequiredErrorBody,
  )
  async payPayout(
    @CurrentStaff() staff: StaffMember,
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', payoutIdPipe) payoutId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PayoutActionResponse> {
    if (!idempotencyKey || !UUID.test(idempotencyKey))
      throw new BadRequestException({
        statusCode: 400,
        error: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header with a UUID.',
      });
    try {
      const now = new Date();
      requireRecentSession({ session, now });
      return {
        status: await this.pay.execute({
          payoutId,
          adminUserId: staff.userId,
          idempotencyKey: idempotencyKey.toLowerCase(),
          now,
        }),
      };
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
    PayoutNotFoundErrorBody,
    PayoutStatusConflictErrorBody,
  )
  async retryPayout(
    @CurrentStaff() staff: StaffMember,
    @Param('id', payoutIdPipe) payoutId: string,
  ): Promise<PayoutActionResponse> {
    try {
      return {
        status: await this.retry.execute({ payoutId, adminUserId: staff.userId, now: new Date() }),
      };
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
    PayoutNotFoundErrorBody,
    PayoutNotRequestedErrorBody,
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
    PayoutNotFoundErrorBody,
    PayoutStatusConflictErrorBody,
    PayoutHeldErrorBody,
    ReferrerBlockedErrorBody,
    PayoutPixKeyChangePendingErrorBody,
    PayoutBelowMinimumAdminErrorBody,
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
