import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { PublishWedding } from '../application/publish-wedding.use-case';
import { PublicationResponse, PublishWeddingBody } from './publication.dto';
import {
  CourtesyDisabledErrorBody,
  EndDateOutOfRangeErrorBody,
  EventDateMissingErrorBody,
  NotDraftErrorBody,
  SiteSlugMissingErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';

/** Publicação por Cortesia (F4), até a F3 trocar pelo pagamento. */
@ApiTags('site')
@Controller('weddings/:weddingId/publication')
export class PublicationController {
  constructor(private readonly publish: PublishWedding) {}

  /** Publica o site sem pagamento, com a data de saída do ar (Publicação RN01 a RN06). */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    CourtesyDisabledErrorBody,
    NotDraftErrorBody,
    SiteSlugMissingErrorBody,
    EventDateMissingErrorBody,
    EndDateOutOfRangeErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: PublishWeddingBody,
    @Req() request: Request,
  ): Promise<PublicationResponse> {
    try {
      const result = await this.publish.execute({
        userId: session.userId,
        weddingId,
        endDate: body.endDate,
        ip: request.ip ?? null,
        now: new Date(),
      });
      return PublicationResponse.from({ result });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
