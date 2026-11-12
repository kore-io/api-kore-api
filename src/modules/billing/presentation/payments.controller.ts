import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import {
  EndDateOutOfRangeErrorBody,
  EventDateMissingErrorBody,
  NotDraftErrorBody,
  SiteSlugMissingErrorBody,
} from '../../site/presentation/site-error.dto';
import { CreatePayment } from '../application/create-payment.use-case';
import { GetBilling } from '../application/get-billing.use-case';
import {
  GatewayUnavailableErrorBody,
  IdempotencyKeyRequiredErrorBody,
  IdempotencyKeyReusedErrorBody,
  InstallmentsOutOfRangeErrorBody,
  PaymentPendingErrorBody,
  PriceChangedErrorBody,
  RefundInProgressErrorBody,
} from './billing-error.dto';
import { toHttpError } from './billing-http-errors';
import { BillingResponse, CreatePaymentBody, PaymentCreatedResponse } from './payments.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Publicar e pagar (F3): o pagamento e a leitura da cobrança. */
@ApiTags('billing')
@Controller('weddings/:weddingId')
export class PaymentsController {
  constructor(
    private readonly createPayment: CreatePayment,
    private readonly getBilling: GetBilling,
  ) {}

  /**
   * Pagar (Publicar e pagar RN03): grava o pendente, cobra fora de transação
   * e grava o retorno do gateway; o site só vai ao ar na confirmação (RN04).
   * Abre as próprias transações (RN19: nenhuma chamada à porta dentro delas).
   */
  @Post('payments')
  @OwnTransactions()
  @HttpCode(HttpStatus.CREATED)
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'UUID (B2-10).' })
  @ApiCreatedResponse({ type: PaymentCreatedResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    IdempotencyKeyRequiredErrorBody,
    InstallmentsOutOfRangeErrorBody,
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    NotDraftErrorBody,
    SiteSlugMissingErrorBody,
    EventDateMissingErrorBody,
    PaymentPendingErrorBody,
    RefundInProgressErrorBody,
    PriceChangedErrorBody,
    EndDateOutOfRangeErrorBody,
    IdempotencyKeyReusedErrorBody,
    GatewayUnavailableErrorBody,
  )
  async pay(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreatePaymentBody,
    @Req() request: Request,
  ): Promise<PaymentCreatedResponse> {
    if (!idempotencyKey || !UUID.test(idempotencyKey))
      throw new BadRequestException({
        statusCode: 400,
        error: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Send an Idempotency-Key header with a UUID.',
      });
    try {
      const payment = await this.createPayment.execute({
        userId: session.userId,
        weddingId,
        idempotencyKey: idempotencyKey.toLowerCase(),
        kind: body.kind,
        endDate: body.endDate,
        method: body.method,
        installments: body.installments,
        payer: body.payer,
        cardToken: body.cardToken ?? null,
        priceVersion: body.priceVersion,
        expectedTotalCents: body.expectedTotalCents,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return PaymentCreatedResponse.from({ payment });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** O status, as datas e, para o dono, os valores (Publicar e pagar, GET …/billing). */
  @Get('billing')
  @ApiOkResponse({ type: BillingResponse })
  @ApiErrorResponses(...commonErrors({ session: true }), WeddingNotFoundErrorBody)
  async billing(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<BillingResponse> {
    try {
      return BillingResponse.from({
        view: await this.getBilling.execute({ userId: session.userId, weddingId }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
