import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { validationError } from '@/shared/http/validation-errors';
import { ActionNotAllowedErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { OwnTransactions } from '@/modules/access/presentation/http/decorators/own-transactions.decorator';
import { AdminReferrers } from '@/modules/backoffice/application/admin-referrers.use-cases';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import {
  AdminReferrerDetailResponse,
  AdminReferrerQuery,
  AdminReferrersQuery,
  AdminReferrersResponse,
} from '@/modules/backoffice/presentation/dto/admin-referrers-read.dto';
import {
  ReferrerNotFoundErrorBody,
  StaffOnlyErrorBody,
} from '@/modules/backoffice/presentation/dto/backoffice-error.dto';
import { toHttpError } from '@/modules/backoffice/presentation/errors/backoffice-http-errors';
import {
  CurrentStaff,
  StaffGuard,
} from '@/modules/backoffice/presentation/http/guards/staff.guard';

/**
 * A leitura das Cerimonialistas (Backoffice - cobrança RN08; Penpot 11), para
 * o Admin e o suporte, com os recortes da decisão 69. As ações do Admin ficam
 * no AdminReferrersController. Pela conexão do backoffice (decisão 180(5)).
 */
@ApiTags('admin')
@Controller('admin/referrers')
@UseGuards(StaffGuard)
export class AdminReferrersReadController {
  constructor(private readonly referrers: AdminReferrers) {}

  @Get()
  @OwnTransactions()
  @ApiOkResponse({ type: AdminReferrersResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
  )
  async list(
    @CurrentStaff() staff: StaffMember,
    @Query() query: AdminReferrersQuery,
  ): Promise<AdminReferrersResponse> {
    try {
      const page = await this.referrers.list({
        staff,
        query: {
          kind: query.kind ?? 'planner',
          status: query.status,
          hasPayout: query.hasPayout === undefined ? undefined : query.hasPayout === 'true',
          city: query.city,
          page: query.page ?? 1,
        },
      });
      return AdminReferrersResponse.from({ page });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  @Get(':id')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminReferrerDetailResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    StaffOnlyErrorBody,
    ActionNotAllowedErrorBody,
    ReferrerNotFoundErrorBody,
  )
  async detail(
    @CurrentStaff() staff: StaffMember,
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
      }),
    )
    referrerId: string,
    @Query() query: AdminReferrerQuery,
    @Req() request: Request,
  ): Promise<AdminReferrerDetailResponse> {
    try {
      const detail = await this.referrers.detail({
        staff,
        referrerId,
        tab: query.tab ?? 'weddings',
        page: query.page ?? 1,
        ip: request.ip ?? null,
      });
      return AdminReferrerDetailResponse.from({ detail });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
