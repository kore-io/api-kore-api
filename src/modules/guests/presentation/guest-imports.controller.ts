import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { DuplicateErrorBody, TooManyGuestsErrorBody } from './guests-error.dto';
import { toHttpError } from './guests-http-errors';
import {
  ImportResultResponse,
  PasteImportBody,
  PastePreviewBody,
  PastePreviewResponse,
} from './import.dto';

/** Importação de convidados: 20 pedidos por minuto por usuário nas 4 rotas (guest_import). */
@ApiTags('guest-imports')
@Controller('weddings/:weddingId/guest-imports')
@UseGuards(GuestImportRateLimitGuard)
export class GuestImportsController {
  constructor(
    private readonly previewPaste: PreviewPastedList,
    private readonly importPaste: ImportPastedList,
  ) {}

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
