import { Body, Controller, Get, Param, ParseEnumPipe, Patch, Put } from '@nestjs/common';
import { validationError } from '../../../shared/http/validation-errors';
import { UpdateSiteSection } from '../application/update-site-section.use-case';
import { SITE_SECTION_TYPES, type SiteSectionType } from '../domain/site-sections';
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
  EndDateOutOfRangeErrorBody,
  SiteFieldNotAllowedErrorBody,
  SiteImageNotFoundErrorBody,
  SiteSlugLockedErrorBody,
  SiteSlugUnavailableErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';
import {
  SiteEditorResponse,
  SiteSectionResponse,
  SiteSongQuestionResponse,
  UpdateSiteBody,
  UpdateSiteSectionBody,
  UpdateSongQuestionBody,
} from './site.dto';
import { UpdateSongQuestion } from '../application/update-song-question.use-case';

/** Editor do site (F2): leitura e Dados básicos. */
@ApiTags('site')
@Controller('weddings/:weddingId/site')
export class SiteController {
  constructor(
    private readonly getEditor: GetSiteEditor,
    private readonly updateBasics: UpdateSiteBasics,
    private readonly updateAppearance: UpdateSiteAppearance,
    private readonly updateSection: UpdateSiteSection,
    private readonly updateSongQuestion: UpdateSongQuestion,
  ) {}

  /** A pergunta de música do RSVP: ligada e o texto (Música RN01 e RN02). */
  @Put('song-question')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
  )
  async songQuestion(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: UpdateSongQuestionBody,
  ): Promise<SiteSongQuestionResponse> {
    try {
      return await this.updateSongQuestion.execute({
        userId: session.userId,
        weddingId,
        enabled: body.enabled,
        text: body.text,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Grava uma seção inteira: ligada, título e conteúdo (Seções RN04 a RN13). */
  @Put('sections/:type')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SiteImageNotFoundErrorBody,
  )
  async section(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Param(
      'type',
      new ParseEnumPipe(Object.fromEntries(SITE_SECTION_TYPES.map((type) => [type, type])), {
        exceptionFactory: () =>
          validationError({
            errors: [{ path: 'type', code: 'IS_IN', params: { values: [...SITE_SECTION_TYPES] } }],
          }),
      }),
    )
    type: SiteSectionType,
    @Body() body: UpdateSiteSectionBody,
  ): Promise<SiteSectionResponse> {
    try {
      return await this.updateSection.execute({
        userId: session.userId,
        weddingId,
        type,
        enabled: body.enabled,
        title: body.title,
        content: body.content,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

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
    EndDateOutOfRangeErrorBody,
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
