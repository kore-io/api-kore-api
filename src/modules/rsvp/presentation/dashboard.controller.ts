import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { WeddingNotFoundErrorBody } from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { GetDashboard } from '../application/dashboard.use-case';
import { DashboardResponse } from './dashboard.dto';
import { toHttpError } from './rsvp-http-errors';

/** O Dashboard do casal (F5). */
@ApiTags('rsvp')
@Controller('weddings/:weddingId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: GetDashboard) {}

  /** Os cartões, o Checklist e a Atividade recente, numa chamada; sem cache (RN08). */
  @Get()
  @ApiErrorResponses(...commonErrors({ session: true }), WeddingNotFoundErrorBody)
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DashboardResponse> {
    response.setHeader('Cache-Control', 'private, no-store');
    try {
      return DashboardResponse.from({
        view: await this.dashboard.execute({
          userId: session.userId,
          weddingId,
          now: new Date(),
        }),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
