import { Controller, Get, Header, Param, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import { WeddingNotFoundErrorBody } from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { ExportGuests } from '../application/export-guests.use-case';
import { NothingToExportErrorBody } from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import { ExportGuestsQuery } from './export.dto';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('guests')
@Controller('weddings/:weddingId/guests')
export class ExportController {
  constructor(private readonly exportGuests: ExportGuests) {}

  /** Exportar: o arquivo na hora, sem cache (Exportação RN01 a RN10). */
  @Get('export')
  @Header('Cache-Control', 'no-store')
  @ApiProduces(XLSX)
  @ApiResponse({
    status: 200,
    description: 'O arquivo.',
    content: { [XLSX]: { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true }),
    WeddingNotFoundErrorBody,
    NothingToExportErrorBody,
  )
  async export(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Query() query: ExportGuestsQuery,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.exportGuests.execute({
        userId: session.userId,
        weddingId,
        format: query.format,
        who: query.who,
        tagId: query.tag,
        columns: query.columns,
        ip: request.ip ?? null,
        now: new Date(),
      });
      response.setHeader('Content-Type', file.contentType);
      // filename em ASCII e filename* em UTF-8 (o slug já é minúsculo e sem acento).
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
