import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { AuthorizeSiteImageUpload } from '../application/authorize-site-image-upload.use-case';
import { SiteImageLimitErrorBody } from './site-error.dto';
import { toHttpError } from './site-http-errors';
import {
  SiteImageUploadAuthorizationBody,
  SiteImageUploadAuthorizationResponse,
} from './site-images.dto';

/** Imagens do site: 30 pedidos por minuto por usuário nas rotas daqui (site_image, RN07). */
@ApiTags('site-images')
@Controller('weddings/:weddingId/site-images')
@UseGuards(SiteImageRateLimitGuard)
export class SiteImagesController {
  constructor(private readonly authorizeUpload: AuthorizeSiteImageUpload) {}

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
