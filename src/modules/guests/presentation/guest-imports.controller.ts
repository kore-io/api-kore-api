import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { GuestImportRateLimitGuard } from '../../../shared/rate-limit/guest-import-rate-limit.guard';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { ImportPastedList, PreviewPastedList } from '../application/import-paste.use-cases';
import { ImportSpreadsheet, PreviewSpreadsheet } from '../application/import-spreadsheet.use-cases';
import { SpreadsheetUploadGuard } from './spreadsheet-upload.guard';
import {
  DuplicateErrorBody,
  FileTooLargeErrorBody,
  NothingToImportErrorBody,
  SpreadsheetRefusedErrorBody,
  TooManyGuestsErrorBody,
} from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import {
  ImportResultResponse,
  PasteImportBody,
  PastePreviewBody,
  PastePreviewResponse,
  SpreadsheetImportResponse,
  SpreadsheetPreviewResponse,
  SpreadsheetUploadBody,
} from './import.dto';

/** Importação de convidados: 20 pedidos por minuto por usuário nas 4 rotas (guest_import). */
@ApiTags('guest-imports')
@Controller('weddings/:weddingId/guest-imports')
@UseGuards(GuestImportRateLimitGuard)
export class GuestImportsController {
  constructor(
    private readonly previewPaste: PreviewPastedList,
    private readonly importPaste: ImportPastedList,
    private readonly previewSheet: PreviewSpreadsheet,
    private readonly importSheet: ImportSpreadsheet,
  ) {}

  /** A planilha, prévia: nada é gravado e o arquivo não é guardado (Importação RN03 a RN09). */
  @Post('spreadsheet/preview')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SpreadsheetUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: SpreadsheetUploadBody })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    FileTooLargeErrorBody,
    SpreadsheetRefusedErrorBody,
  )
  async spreadsheetPreview(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Req() request: Request,
  ): Promise<SpreadsheetPreviewResponse> {
    const file = request.file as Express.Multer.File;
    try {
      return await this.previewSheet.execute({
        userId: session.userId,
        weddingId,
        file: file.buffer,
        fileName: file.originalname,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** A planilha, importar: valida de novo e grava só as linhas válidas (RN01, RN09 e RN14). */
  @Post('spreadsheet')
  @UseGuards(SpreadsheetUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: SpreadsheetUploadBody })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    FileTooLargeErrorBody,
    SpreadsheetRefusedErrorBody,
    NothingToImportErrorBody,
  )
  async spreadsheet(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Req() request: Request,
  ): Promise<SpreadsheetImportResponse> {
    const file = request.file as Express.Multer.File;
    try {
      return await this.importSheet.execute({
        userId: session.userId,
        weddingId,
        file: file.buffer,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Colar a lista, prévia: nada é gravado (Importação RN10 e RN11). */
  @Post('paste/preview')
  @HttpCode(HttpStatus.OK)
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TooManyGuestsErrorBody,
  )
  async pastePreview(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: PastePreviewBody,
  ): Promise<PastePreviewResponse> {
    try {
      return await this.previewPaste.execute({
        userId: session.userId,
        weddingId,
        text: body.text,
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Colar a lista, importar: valida de novo e cria tudo numa transação (RN12 e RN14). */
  @Post('paste')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    TooManyGuestsErrorBody,
    DuplicateErrorBody,
  )
  async paste(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: PasteImportBody,
  ): Promise<ImportResultResponse> {
    try {
      return await this.importPaste.execute({
        userId: session.userId,
        weddingId,
        groups: body.groups,
        removedInPreview: body.removedInPreview,
        now: new Date(),
      });
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
