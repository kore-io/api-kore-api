import {
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
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import { validationError } from '@/shared/http/validation-errors';
import { OwnTransactions } from '@/modules/access/presentation/http/decorators/own-transactions.decorator';
import { AdminInsights } from '@/modules/backoffice/application/admin-insights.use-cases';
import type { StaffMember } from '@/modules/backoffice/domain/staff';
import {
  AdminAlertResolvedResponse,
  AdminAlertsQuery,
  AdminAlertsResponse,
  AdminLogsQuery,
  AdminLogsResponse,
  AdminOverviewResponse,
  AdminSearchQuery,
  AdminSearchResponse,
} from '@/modules/backoffice/presentation/dto/admin-insights.dto';
import {
  AlertAlreadyResolvedErrorBody,
  AlertNotFoundErrorBody,
  StaffOnlyErrorBody,
} from '@/modules/backoffice/presentation/dto/backoffice-error.dto';
import { toHttpError } from '@/modules/backoffice/presentation/errors/backoffice-http-errors';
import {
  CurrentStaff,
  StaffGuard,
} from '@/modules/backoffice/presentation/http/guards/staff.guard';

/**
 * Visão geral, busca, log e alertas do Backoffice (Backoffice - acesso RN03,
 * RN04, RN11 e RN12), para o Admin e o suporte.
 */
@ApiTags('admin')
@Controller('admin')
@UseGuards(StaffGuard)
export class AdminInsightsController {
  constructor(private readonly insights: AdminInsights) {}

  @Get('overview')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminOverviewResponse })
  @ApiErrorResponses(...commonErrors({ session: true }), StaffOnlyErrorBody)
  async overview(@CurrentStaff() staff: StaffMember): Promise<AdminOverviewResponse> {
    return AdminOverviewResponse.from({
      overview: await this.insights.overview({ staff, now: new Date() }),
    });
  }

  @Get('search')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminSearchResponse })
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), StaffOnlyErrorBody)
  async search(
    @CurrentStaff() staff: StaffMember,
    @Query() query: AdminSearchQuery,
    @Req() request: Request,
  ): Promise<AdminSearchResponse> {
    return AdminSearchResponse.from({
      result: await this.insights.search({ staff, term: query.q, ip: request.ip ?? null }),
    });
  }

  @Get('logs')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminLogsResponse })
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), StaffOnlyErrorBody)
  async logs(
    @CurrentStaff() staff: StaffMember,
    @Query() query: AdminLogsQuery,
  ): Promise<AdminLogsResponse> {
    const page = await this.insights.logs({
      staff,
      query: { ...query, page: query.page ?? 1 },
      now: new Date(),
    });
    return AdminLogsResponse.from({ page });
  }

  @Get('alerts')
  @OwnTransactions()
  @ApiOkResponse({ type: AdminAlertsResponse })
  @ApiErrorResponses(...commonErrors({ validated: true, session: true }), StaffOnlyErrorBody)
  async alerts(
    @CurrentStaff() staff: StaffMember,
    @Query() query: AdminAlertsQuery,
  ): Promise<AdminAlertsResponse> {
    const page = await this.insights.alerts({
      staff,
      status: query.status ?? 'open',
      page: query.page ?? 1,
    });
    return AdminAlertsResponse.from({ page });
  }

  @Post('alerts/:id/resolve')
  @OwnTransactions()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: AdminAlertResolvedResponse })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    StaffOnlyErrorBody,
    AlertNotFoundErrorBody,
    AlertAlreadyResolvedErrorBody,
  )
  async resolve(
    @CurrentStaff() staff: StaffMember,
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () =>
          validationError({ errors: [{ path: 'id', code: 'IS_UUID', params: {} }] }),
      }),
    )
    alertId: string,
    @Req() request: Request,
  ): Promise<AdminAlertResolvedResponse> {
    try {
      await this.insights.resolveAlert({ staff, alertId, ip: request.ip ?? null, now: new Date() });
      return { status: 'resolved' };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
