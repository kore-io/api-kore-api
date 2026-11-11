import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { GetSiteEditor } from '../application/site-editor-view';
import { UpdateSiteBasics } from '../application/update-site-basics.use-case';
import { UpdateSiteAppearance } from '../application/update-site-appearance.use-case';
import { SiteAppearanceResponse, UpdateSiteAppearanceBody } from './site-appearance.dto';
import {
  ContrastTooLowErrorBody,
  SiteFieldNotAllowedErrorBody,
  SiteImageNotFoundErrorBody,
  SiteSlugLockedErrorBody,
  SiteSlugUnavailableErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';
import { SiteEditorResponse, UpdateSiteBody } from './site.dto';

/** Editor do site (F2): leitura e Dados básicos. */
@ApiTags('site')
@Controller('weddings/:weddingId/site')
export class SiteController {
  constructor(
    private readonly getEditor: GetSiteEditor,
    private readonly updateBasics: UpdateSiteBasics,
    private readonly updateAppearance: UpdateSiteAppearance,
  ) {}

  /** Grava a Aparência inteira, com o guarda-corpo de contraste (Aparência RN01 a RN07). */
  @Put('appearance')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    ContrastTooLowErrorBody,
  )
  async appearance(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: UpdateSiteAppearanceBody,
  ): Promise<SiteAppearanceResponse> {
    try {
      return await this.updateAppearance.execute({
        userId: session.userId,
        weddingId,
        input: body,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Tudo o que o Editor mostra, numa chamada (Dados básicos RN11). */
  @Get()
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async get(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
  ): Promise<SiteEditorResponse> {
    try {
      const view = await this.getEditor.execute({ userId: session.userId, weddingId });
      return SiteEditorResponse.from({ view });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava os Dados básicos; só o enviado muda (Dados básicos RN02 a RN10). */
  @Patch()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SiteFieldNotAllowedErrorBody,
    SiteImageNotFoundErrorBody,
    SiteSlugLockedErrorBody,
    SiteSlugUnavailableErrorBody,
  )
  async patch(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: UpdateSiteBody,
  ): Promise<SiteEditorResponse> {
    try {
      const view = await this.updateBasics.execute({
        userId: session.userId,
        weddingId,
        input: body,
        now: new Date(),
      });
      return SiteEditorResponse.from({ view });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
