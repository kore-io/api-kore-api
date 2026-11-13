import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { ProfileNotOwnedErrorBody } from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import {
  IdempotencyKeyRequiredErrorBody,
  IdempotencyKeyReusedErrorBody,
} from '../../billing/presentation/billing-error.dto';
import type { PayoutRow } from '../application/ports/payout-store.port';
import { PayoutsUseCases } from '../application/payouts.use-cases';
import { PixKeyChangePendingErrorBody } from './payout-data.dto';
import {
  PayoutAmountChangedErrorBody,
  PayoutBelowMinimumErrorBody,
  PayoutDataMissingErrorBody,
  PayoutOpenErrorBody,
  PayoutResponse,
  PayoutsDisabledErrorBody,
  PayoutsResponse,
  PayoutTooSoonErrorBody,
  RequestPayoutBody,
} from './payouts.dto';
import { toReferralHttpError } from './referral-http-errors';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toResponse = (row: PayoutRow): PayoutResponse => ({
  id: row.id,
  amountCents: row.amountCents,
  status: row.status,
  holdReason: row.holdReason,
  pixKeyMasked: row.pixKeyMasked,
  requestedAt: row.requestedAt.toISOString(),
  paidAt: row.paidAt?.toISOString() ?? null,
  rejectReason: row.rejectReason,
  receiptUrl: null,
});

/** Comissões › Repasses (Repasse e Dados para receber RN01, RN04 e RN09; decisão 247). */
@ApiTags('referral')
@Controller('me/referrer/payouts')
export class PayoutsController {
  constructor(private readonly payouts: PayoutsUseCases) {}

  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), ProfileNotOwnedErrorBody)
  async list(@CurrentSession() session: AuthenticatedSession): Promise<PayoutsResponse> {
    try {
      const view = await this.payouts.list({ userId: session.userId, now: new Date() });
      return {
        payoutsEnabled: view.payoutsEnabled,
        nextRequestAt: view.nextRequestAt?.toISOString() ?? null,
        pixKeyActiveFrom: view.pixKeyActiveFrom?.toISOString() ?? null,
        minimumCents: view.minimumCents,
        items: view.items.map(toResponse),
      };
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }

  /** RN04: pedir o repasse de todo o saldo disponível. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID (B2-10).' })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ProfileNotOwnedErrorBody,
    IdempotencyKeyRequiredErrorBody,
    IdempotencyKeyReusedErrorBody,
    PayoutsDisabledErrorBody,
    PayoutDataMissingErrorBody,
    PixKeyChangePendingErrorBody,
    PayoutOpenErrorBody,
    PayoutTooSoonErrorBody,
    PayoutBelowMinimumErrorBody,
    PayoutAmountChangedErrorBody,
  )
  async request(
    @CurrentSession() session: AuthenticatedSession,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: RequestPayoutBody,
  ): Promise<PayoutResponse> {
    if (!idempotencyKey || !UUID.test(idempotencyKey))
      throw new BadRequestException({
        statusCode: 400,
        error: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header with a UUID.',
      });
    try {
      const { payout } = await this.payouts.request({
        userId: session.userId,
        idempotencyKey: idempotencyKey.toLowerCase(),
        expectedAmountCents: body.expectedAmountCents,
        now: new Date(),
      });
      return toResponse(payout);
    } catch (error) {
      throw toReferralHttpError(error);
    }
  }
}
