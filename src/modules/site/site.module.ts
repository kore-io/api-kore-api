import { Module } from '@nestjs/common';
import { SiteImageRateLimitGuard } from '../../shared/rate-limit/user-rate-limit.guard';
import { AccessModule } from '../access/access.module';
import { AuthorizeSiteImageUpload } from './application/authorize-site-image-upload.use-case';
import { ConfirmSiteImage } from './application/confirm-site-image.use-case';
import { SITE_IMAGE_PROCESSOR } from './application/ports/site-image-processor.port';
import { SharpSiteImageProcessor } from './infrastructure/sharp-site-image.processor';
import { SITE_IMAGE_STORE } from './application/ports/site-image-store.port';
import { PrismaSiteImageStore } from './infrastructure/prisma-site-image.store';
import { SiteImagesController } from './presentation/site-images.controller';

/** Contexto Site (F2): Editor do site, imagens, site público, prévia e Simule. */
@Module({
  imports: [AccessModule],
  controllers: [SiteImagesController],
  providers: [
    { provide: SITE_IMAGE_STORE, useClass: PrismaSiteImageStore },
    AuthorizeSiteImageUpload,
    { provide: SITE_IMAGE_PROCESSOR, useClass: SharpSiteImageProcessor },
    ConfirmSiteImage,
    SiteImageRateLimitGuard,
  ],
})
export class SiteModule {}
