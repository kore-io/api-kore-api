import { AllowWhenBlocked } from '../../access/presentation/allow-when-blocked.decorator';
import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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
import { CreateSitePreview } from '../application/site-preview.use-cases';
import { PreviewModeBody, SitePreviewResponse } from './public-site.dto';
import { SitePartyNotFoundErrorBody, SiteSlugMissingErrorBody } from './site-error.dto';
import { toHttpError } from './site-http-errors';

/** Pré-visualizar e Ver como este grupo (Pré-visualização RN01 e RN02; rota do app). */
@ApiTags('site')
@Controller('weddings/:weddingId/site-previews')
export class SitePreviewsController {
  constructor(private readonly createPreview: CreateSitePreview) {}

  /** O token da prévia e a `url` do site com ele; vale 5 minutos e uma vez só. */
  // Casamento bloqueado RN03: a pré-visualização é leitura.
  @AllowWhenBlocked()
  @Post()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SiteSlugMissingErrorBody,
    SitePartyNotFoundErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: PreviewModeBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SitePreviewResponse> {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const preview = await this.createPreview.execute({
        userId: session.userId,
        weddingId,
        mode: body.mode,
        partyId: body.partyId ?? null,
        now: new Date(),
      });
      return { url: preview.url, expiresAt: preview.expiresAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
