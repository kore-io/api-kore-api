import { Module } from '@nestjs/common';
import { SiteImageRateLimitGuard } from '../../shared/rate-limit/user-rate-limit.guard';
import { AccessModule } from '../access/access.module';
import { AuthorizeSiteImageUpload } from './application/authorize-site-image-upload.use-case';
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
    SiteImageRateLimitGuard,
  ],
})
export class SiteModule {}
