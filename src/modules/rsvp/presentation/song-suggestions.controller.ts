import { Controller, Get, Header, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
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
import { NothingToExportErrorBody } from '../../guests/presentation/guests-error.dto';
import {
  ExportSongSuggestions,
  ListSongSuggestions,
} from '../application/song-suggestions.use-cases';
import { toHttpError } from './rsvp-http-errors';
import {
  SongQuestionDisabledErrorBody,
  SongSuggestionsQuery,
  SongSuggestionsResponse,
} from './song-suggestions.dto';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Músicas: as sugestões dos convidados e a lista para o DJ (F4). */
@ApiTags('rsvp')
@Controller('weddings/:weddingId/song-suggestions')
export class SongSuggestionsController {
  constructor(
    private readonly list: ListSongSuggestions,
    private readonly exportSongs: ExportSongSuggestions,
  ) {}

  /** A página Músicas (Música RN05). */
  @Get()
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SongQuestionDisabledErrorBody,
  )
  async page(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Query() query: SongSuggestionsQuery,
  ): Promise<SongSuggestionsResponse> {
    try {
      const page = await this.list.execute({
        userId: session.userId,
        weddingId,
        cursor: query.cursor,
      });
      return {
        ...page,
        items: page.items.map((item) => ({ ...item, suggestedAt: item.suggestedAt.toISOString() })),
      };
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Exportar para o DJ: o .xlsx na hora, sem cache (Música RN06). */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @ApiProduces(XLSX)
  @ApiResponse({
    status: 200,
    description: 'O arquivo.',
    content: { [XLSX]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponses(
    ...commonErrors({ session: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SongQuestionDisabledErrorBody,
    NothingToExportErrorBody,
  )
  async export(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.exportSongs.execute({ userId: session.userId, weddingId });
      response.setHeader('Content-Type', XLSX);
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.fileName}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      );
      return new StreamableFile(file.content);
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
