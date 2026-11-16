import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorResponses, commonErrors } from '@/shared/http/api-error-responses.decorator';
import type { AuthenticatedSession } from '@/modules/access/domain/sessions/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '@/modules/access/presentation/dto/access-error.dto';
import { CurrentSession } from '@/modules/access/presentation/http/decorators/current-session.decorator';
import { DownloadQrCodes } from '@/modules/rsvp/application/qr-codes.use-case';
import {
  DeliveriesClosedErrorBody,
  SiteExpiredConflictErrorBody,
  DeliveryPartyNotFoundErrorBody,
  QrCodesBody,
} from '@/modules/rsvp/presentation/dto/deliveries.dto';
import { toHttpError } from '@/modules/rsvp/presentation/errors/rsvp-http-errors';

/** O QR code do convite impresso (F4; Envios RN09). */
@ApiTags('rsvp')
@Controller('weddings/:weddingId/parties/qr-codes')
export class QrCodesController {
  constructor(private readonly download: DownloadQrCodes) {}

  /**
   * Gera o arquivo e marca o envio do convite dos grupos, com o canal QR.
   * `POST` (R4-1): nenhum `GET` marca grupo, e não há choque com `GET parties/:partyId`.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiProduces('image/png', 'application/pdf')
  @ApiResponse({
    status: 200,
    description: 'O arquivo: PNG de 1024 × 1024 com 1 grupo; PDF A4 com um QR por página.',
    content: {
      'image/png': { schema: { type: 'string', format: 'binary' } },
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    DeliveriesClosedErrorBody,
    SiteExpiredConflictErrorBody,
    DeliveryPartyNotFoundErrorBody,
  )
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: QrCodesBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.download.execute({
        userId: session.userId,
        weddingId,
        partyIds: body.partyIds,
        format: body.format,
        now: new Date(),
      });
      response.setHeader('Content-Type', file.contentType);
      // O nome do arquivo em ASCII e em UTF-8; exposto no CORS (decisão 212(4)).
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
