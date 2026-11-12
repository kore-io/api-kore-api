import { Body, Controller, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  ApiErrorResponses,
  commonErrors,
} from '../../../shared/http/api-error-responses.decorator';
import { SiteImageRateLimitGuard } from '../../../shared/rate-limit/user-rate-limit.guard';
import type { AuthenticatedSession } from '../../access/domain/authenticated-session';
import {
  ActionNotAllowedErrorBody,
  WeddingNotFoundErrorBody,
} from '../../access/presentation/access-error.dto';
import { CurrentSession } from '../../access/presentation/current-session.decorator';
import { OwnTransactions } from '../../access/presentation/own-transactions.decorator';
import { ConfirmSiteImage } from '../application/confirm-site-image.use-case';
import { AuthorizeSiteImageUpload } from '../application/authorize-site-image-upload.use-case';
import {
  SiteImageInvalidErrorBody,
  SiteImageLimitErrorBody,
  SiteImageNotFoundErrorBody,
  SiteImageProcessingErrorBody,
  SiteImageUploadMissingErrorBody,
} from './site-error.dto';
import { toHttpError } from './site-http-errors';
import {
  ConfirmSiteImageBody,
  SiteImageResponse,
  SiteImageUploadAuthorizationBody,
  SiteImageUploadAuthorizationResponse,
} from './site-images.dto';

/** Imagens do site: 30 pedidos por minuto por usuário nas rotas daqui (site_image, RN07). */
@ApiTags('site-images')
@Controller('weddings/:weddingId/site-images')
@UseGuards(SiteImageRateLimitGuard)
export class SiteImagesController {
  constructor(
    private readonly authorizeUpload: AuthorizeSiteImageUpload,
    private readonly confirmImage: ConfirmSiteImage,
  ) {}

  /**
   * Confirma o envio e processa na hora (Imagens do site RN05): 201 com a
   * imagem pronta; 200 quando ela já estava pronta (confirmação repetida). O
   * processamento fica fora da transação do banco (@OwnTransactions).
   */
  @Post()
  @OwnTransactions()
  @ApiCreatedResponse({ type: SiteImageResponse, description: 'Processada agora.' })
  @ApiOkResponse({ type: SiteImageResponse, description: 'Já estava pronta (idempotente).' })
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SiteImageNotFoundErrorBody,
    SiteImageProcessingErrorBody,
    SiteImageUploadMissingErrorBody,
    SiteImageInvalidErrorBody,
  )
  async confirm(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: ConfirmSiteImageBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SiteImageResponse> {
    try {
      const { image, processed } = await this.confirmImage.execute({
        userId: session.userId,
        weddingId,
        imageId: body.imageId,
        now: () => new Date(),
      });
      if (!processed) response.status(HttpStatus.OK);
      return image;
    } catch (error) {
      throw toHttpError(error);
    }
  }

  /** Autorização de envio direto ao armazenamento (Imagens do site RN04 e RN07). */
  @Post('upload-authorizations')
  @ApiErrorResponses(
    ...commonErrors({ validated: true, session: true, write: true }),
    ActionNotAllowedErrorBody,
    WeddingNotFoundErrorBody,
    SiteImageLimitErrorBody,
  )
  async authorize(
    @CurrentSession() session: AuthenticatedSession,
    @Param('weddingId') weddingId: string,
    @Body() body: SiteImageUploadAuthorizationBody,
  ): Promise<SiteImageUploadAuthorizationResponse> {
    try {
      const authorization = await this.authorizeUpload.execute({
        userId: session.userId,
        weddingId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        now: new Date(),
      });
      return { ...authorization, expiresAt: authorization.expiresAt.toISOString() };
    } catch (error) {
      throw toHttpError(error);
    }
  }
}
