import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { validationError } from '../../../shared/http/validation-errors';
import { ActionNotAllowedErrorBody } from '../../access/presentation/access-error.dto';
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import { AdminPaymentActions } from '../../billing/application/admin-payment-actions.use-cases';
import { AdminRefund } from '../../billing/application/admin-refund.use-case';
import { AdminPayments } from '../application/admin-payments.use-cases';
import type { StaffMember } from '../domain/staff';
import {
  AdminPaymentActionResponse,
  AdminPaymentDetailResponse,
  AdminPaymentsExportQuery,
  AdminPaymentsQuery,
  AdminPaymentsResponse,
  AdminRefundBody,
  AdminRefundResponse,
  ManualRefundBody,
  RefundReceiptUploadBody,
  RefundReceiptUploadResponse,
} from './admin-payments.dto';
import {
  PaymentDisputedErrorBody,
  PaymentNotFoundErrorBody,
  PaymentNotMismatchedErrorBody,
  PaymentNotPaidErrorBody,
  RefundAlreadyRequestedErrorBody,
  RefundNotFailedErrorBody,
  RefundNotLastExtensionErrorBody,
  RefundNotRequestedErrorBody,
  RefundReceiptMissingErrorBody,
  RefundReceiptNotFoundErrorBody,
} from '../../billing/presentation/billing-error.dto';
import { AdminReasonBody } from './admin-weddings.dto';
import { StaffOnlyErrorBody } from './backoffice-error.dto';
import { toHttpError } from './backoffice-http-errors';
import { CurrentStaff, StaffGuard, StaffRoles } from './staff.guard';

const paymentIdPipe = new ParseUUIDPipe({
  exceptionFactory: () =>
    validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
});

/** A Cobrança (Backoffice - cobrança RN01 a RN05, RN07 e RN11): só o Admin. */
@ApiTags('admin')
@Controller('admin/payments')
@UseGuards(StaffGuard)
@StaffRoles('admin')
export class AdminPaymentsController {
  constructor(
    private readonly payments: AdminPayments,
    private readonly refund: AdminRefund,
    private readonly actions: AdminPaymentActions,
  ) {}

  @Get()
  @OwnTransactions()
  @ApiOkResponse({ type: AdminPaymentsResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async list(@Query() query: AdminPaymentsQuery): Promise<AdminPaymentsResponse> {
    const page = await this.payments.list({ query: { ...query, page: query.page ?? 1 } });
    return AdminPaymentsResponse.from({ page });
  }

  /** Exportar CSV (RN07): os pagamentos e os estornos do período, para a contabilidade. */
  @Get('export')
  @OwnTransactions()
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'O CSV.',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async export(
    @CurrentStaff() staff: StaffMember,
    @Query() query: AdminPaymentsExportQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.payments.export({
      staff,
      from: query.from,
      to: query.to,
      ip: request.ip ?? null,
    });
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="kore-pagamentos-${query.from.toISOString().slice(0, 10)}-${query.to.toISOString().slice(0, 10)}.csv"`,
    );
    return new StreamableFile(Buffer.from(`\uFEFF${file.content}`, 'utf8'));
  }

  @Get(':id')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminPaymentDetailResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
  )
  async detail(@Param('id', paymentIdPipe) paymentId: string): Promise<AdminPaymentDetailResponse> {
    try {
      return AdminPaymentDetailResponse.fromDetail({
        detail: await this.payments.detail({ paymentId }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Reembolsar (RN05): integral, a qualquer momento; o estorno por job. */
  @Post(':id/refund')
  @OwnTransactions()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: AdminRefundResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    PaymentDisputedErrorBody,
    RefundAlreadyRequestedErrorBody,
    PaymentNotPaidErrorBody,
    RefundNotLastExtensionErrorBody,
  )
  async refundPayment(
    @CurrentStaff() staff: StaffMember,
    @Param('id', paymentIdPipe) paymentId: string,
    @Body() body: AdminRefundBody,
  ): Promise<AdminRefundResponse> {
    try {
      const { refundsPaymentIds, pastGatewayWindow } = await this.refund.execute({
        paymentId,
        adminUserId: staff.userId,
        reason: body.reason || null,
        now: new Date(),
      });
      return { status: 'refund_requested', refundsPaymentIds, pastGatewayWindow };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Aplicar mesmo assim (RN11, o valor menor no gateway). */
  @Post(':id/apply')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminPaymentActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    PaymentNotMismatchedErrorBody,
  )
  async apply(
    @CurrentStaff() staff: StaffMember,
    @Param('id', paymentIdPipe) paymentId: string,
    @Body() body: AdminReasonBody,
  ): Promise<AdminPaymentActionResponse> {
    try {
      await this.actions.applyAnyway({
        paymentId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'applied' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Tentar o estorno de novo (RN11, o estorno que falhou). */
  @Post(':id/refund/retry')
  @OwnTransactions()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOkResponse({ type: AdminPaymentActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    RefundNotFailedErrorBody,
  )
  async retryRefund(
    @CurrentStaff() staff: StaffMember,
    @Param('id', paymentIdPipe) paymentId: string,
    @Body() body: AdminReasonBody,
  ): Promise<AdminPaymentActionResponse> {
    try {
      await this.actions.retryRefund({
        paymentId,
        adminUserId: staff.userId,
        reason: body.reason,
        now: new Date(),
      });
      return { status: 'refund_retried' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Registrar reembolso feito por fora (RN11): motivo e comprovante. */
  @Post(':id/refund/manual')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminPaymentActionResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    RefundNotRequestedErrorBody,
    RefundReceiptMissingErrorBody,
  )
  async manualRefund(
    @CurrentStaff() staff: StaffMember,
    @Param('id', paymentIdPipe) paymentId: string,
    @Body() body: ManualRefundBody,
  ): Promise<AdminPaymentActionResponse> {
    try {
      await this.actions.recordManualRefund({
        paymentId,
        adminUserId: staff.userId,
        reason: body.reason,
        receiptKey: body.receipt,
        now: new Date(),
      });
      return { status: 'refunded' };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** O envio do comprovante do reembolso feito por fora (decisão 259(1)): a URL de PUT. */
  @Post(':id/refund/receipt-upload')
  @OwnTransactions()
  @HttpCode(HttpStatus.CREATED)
  @ApiOkResponse({ type: RefundReceiptUploadResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    RefundNotRequestedErrorBody,
  )
  async authorizeReceiptUpload(
    @Param('id', paymentIdPipe) paymentId: string,
    @Body() body: RefundReceiptUploadBody,
  ): Promise<RefundReceiptUploadResponse> {
    try {
      const { receiptKey, upload } = await this.actions.authorizeReceiptUpload({
        paymentId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        now: new Date(),
      });
      return {
        receiptKey,
        url: upload.url,
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** O comprovante, só para o Admin (decisão 259(1)): lido pela API, nunca público. */
  @Get(':id/refund/receipt')
  @OwnTransactions()
  @Header('Cache-Control', 'no-store')
  @ApiProduces('application/pdf', 'image/jpeg', 'image/png')
  @ApiOkResponse({ description: 'O arquivo do comprovante.' })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    PaymentNotFoundErrorBody,
    RefundReceiptNotFoundErrorBody,
  )
  async receipt(
    @Param('id', paymentIdPipe) paymentId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.actions.readReceipt({ paymentId });
      response.setHeader('Content-Type', file.contentType);
      response.setHeader('Content-Disposition', 'attachment; filename="comprovante"');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      return new StreamableFile(file.body);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
