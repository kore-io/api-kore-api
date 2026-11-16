import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import { WeddingNotFoundErrorBody } from '@/modules/access/presentation/dto/access-error.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { GetDashboard } from '@/modules/rsvp/application/dashboard/dashboard.use-case';
import { DashboardResponse } from '@/modules/rsvp/presentation/dto/dashboard.dto';
import { toHttpError } from '@/modules/rsvp/presentation/errors/rsvp-http-errors';

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
