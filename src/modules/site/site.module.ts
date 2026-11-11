import { Module } from '@nestjs/common';
import { SiteImageRateLimitGuard } from '../../shared/rate-limit/user-rate-limit.guard';
import { AccessModule } from '../access/access.module';
import { AuthorizeSiteImageUpload } from './application/authorize-site-image-upload.use-case';
import { ConfirmSiteImage } from './application/confirm-site-image.use-case';
import { SITE_IMAGE_PROCESSOR } from './application/ports/site-image-processor.port';
import { SharpSiteImageProcessor } from './infrastructure/sharp-site-image.processor';
import { SITE_READER } from './application/ports/site-reader.port';
import { SITE_STORE } from './application/ports/site-store.port';
import { GetSiteEditor, SiteEditorViews } from './application/site-editor-view';
import { UpdateSiteSection } from './application/update-site-section.use-case';
import { UpdateSiteAppearance } from './application/update-site-appearance.use-case';
import { UpdateSiteBasics } from './application/update-site-basics.use-case';
import { PrismaSiteReader } from './infrastructure/prisma-site.reader';
import { PrismaSiteStore } from './infrastructure/prisma-site.store';
import { PartyLinkFailures } from '../../shared/rate-limit/party-link-failures';
import { PARTY_COOKIES } from './application/ports/party-cookies.port';
import { StartPartySession } from './application/start-party-session.use-case';
import { HmacPartyCookies } from './infrastructure/hmac-party-cookies';
import { PUBLIC_SITE_READER } from './application/ports/public-site-reader.port';
import { GetPublicSite, GetSiteLinkPreview } from './application/public-site.use-cases';
import { PrismaPublicSiteReader } from './infrastructure/prisma-public-site.reader';
import {
  PublicSiteController,
  SiteLinkPreviewController,
} from './presentation/public-site.controller';
import { SiteController } from './presentation/site.controller';
import { SITE_IMAGE_STORE } from './application/ports/site-image-store.port';
import { PrismaSiteImageStore } from './infrastructure/prisma-site-image.store';
import { SiteImagesController } from './presentation/site-images.controller';

/** Contexto Site (F2): Editor do site, imagens, site público, prévia e Simule. */
@Module({
  imports: [AccessModule],
  controllers: [
    SiteImagesController,
    SiteController,
    PublicSiteController,
    SiteLinkPreviewController,
  ],
  providers: [
    { provide: SITE_IMAGE_STORE, useClass: PrismaSiteImageStore },
    AuthorizeSiteImageUpload,
    { provide: SITE_IMAGE_PROCESSOR, useClass: SharpSiteImageProcessor },
    ConfirmSiteImage,
    { provide: SITE_READER, useClass: PrismaSiteReader },
    { provide: SITE_STORE, useClass: PrismaSiteStore },
    SiteEditorViews,
    GetSiteEditor,
    UpdateSiteBasics,
    UpdateSiteAppearance,
    UpdateSiteSection,
    { provide: PUBLIC_SITE_READER, useClass: PrismaPublicSiteReader },
    GetPublicSite,
    { provide: PARTY_COOKIES, useClass: HmacPartyCookies },
    PartyLinkFailures,
    StartPartySession,
    GetSiteLinkPreview,
    SiteImageRateLimitGuard,
  ],
})
export class SiteModule {}
