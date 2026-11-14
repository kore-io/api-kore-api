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
import type { StaffMember } from '../domain/staff';
import {
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
} from './admin-weddings.dto';
import { CurrentStaff, StaffGuard } from './staff.guard';

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
  constructor(private readonly weddings: AdminWeddings) {}

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
  ): Promise<AdminBlockStateResponse> {
    try {
      await this.weddings.block({ staff, weddingId, reason: body.reason, now: new Date() });
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
  ): Promise<AdminBlockStateResponse> {
    try {
      await this.weddings.unblock({ staff, weddingId, reason: body.reason, now: new Date() });
      return { blocked: false };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
