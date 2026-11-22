import { Module } from '@nestjs/common';
import { ipFailureLimitProviders } from '@/shared/rate-limit/ip-failure-limit';
import { SiteImageRateLimitGuard } from '@/shared/rate-limit/user-rate-limit.guard';
import { AccessModule } from '@/modules/access/access.module';
import { AuthorizeSiteImageUpload } from './application/images/authorize-site-image-upload.use-case';
import { ConfirmSiteImage } from './application/images/confirm-site-image.use-case';
import { SITE_IMAGE_PROCESSOR } from './application/ports/site-image-processor.port';
import { SharpSiteImageProcessor } from './infrastructure/providers/sharp-site-image.processor';
import { SITE_READER } from './application/ports/site-reader.port';
import { SITE_STORE } from './application/ports/site-store.port';
import { GetSiteEditor, SiteEditorViews } from './application/editor/site-editor-view';
import { UpdateSiteSection } from './application/editor/update-site-section.use-case';
import { UpdateSongQuestion } from './application/editor/update-song-question.use-case';
import { UpdateSiteAppearance } from './application/editor/update-site-appearance.use-case';
import { UpdateSiteBasics } from './application/editor/update-site-basics.use-case';
import { PrismaSiteReader } from './infrastructure/persistence/prisma-site.reader';
import { PrismaSiteStore } from './infrastructure/persistence/prisma-site.store';
import { PartyLinkFailures } from '@/shared/rate-limit/party-link-failures';
import { PARTY_COOKIES } from './application/ports/party-cookies.port';
import { StartPartySession } from './application/public-site/start-party-session.use-case';
import { PARTY_VISITS } from './application/ports/party-visits.port';
import { PrismaPartyVisits } from './infrastructure/persistence/prisma-party-visits';
import { HmacPartyCookies } from './infrastructure/providers/hmac-party-cookies';
import { PREVIEW_COOKIES } from './application/ports/preview-cookies.port';
import { SITE_PREVIEW_STORE } from './application/ports/site-preview-store.port';
import { PreviewSessions } from './application/preview/preview-sessions.service';
import {
  CreateSitePreview,
  ListPreviewParties,
  StartPreviewSession,
  UpdatePreviewSession,
} from './application/preview/site-preview.use-cases';
import { HmacPreviewCookies } from './infrastructure/providers/hmac-preview-cookies';
import { PrismaSitePreviewStore } from './infrastructure/persistence/prisma-site-preview.store';
import { SitePreviewsController } from './presentation/controllers/site-previews.controller';
import { PUBLIC_SITE_READER } from './application/ports/public-site-reader.port';
import { GetPublicSite, GetSiteLinkPreview } from './application/public-site/public-site.use-cases';
import { PrismaPublicSiteReader } from './infrastructure/persistence/prisma-public-site.reader';
import {
  PublicSiteController,
  SiteLinkPreviewController,
} from './presentation/controllers/public-site.controller';
import { SiteController } from './presentation/controllers/site.controller';
import { SITE_IMAGE_STORE } from './application/ports/site-image-store.port';
import { PrismaSiteImageStore } from './infrastructure/persistence/prisma-site-image.store';
import { SiteImagesController } from './presentation/controllers/site-images.controller';

/** Contexto Site (F2): Editor do site, imagens, site público, prévia e Simule. */
@Module({
  imports: [AccessModule],
  controllers: [
    SiteImagesController,
    SiteController,
    PublicSiteController,
    SiteLinkPreviewController,
    SitePreviewsController,
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
    UpdateSongQuestion,
    { provide: PUBLIC_SITE_READER, useClass: PrismaPublicSiteReader },
    GetPublicSite,
    { provide: PARTY_COOKIES, useClass: HmacPartyCookies },
    PartyLinkFailures,
    ...ipFailureLimitProviders,
    { provide: PARTY_VISITS, useClass: PrismaPartyVisits },
    StartPartySession,
    { provide: PREVIEW_COOKIES, useClass: HmacPreviewCookies },
    { provide: SITE_PREVIEW_STORE, useClass: PrismaSitePreviewStore },
    PreviewSessions,
    CreateSitePreview,
    StartPreviewSession,
    UpdatePreviewSession,
    ListPreviewParties,
    GetSiteLinkPreview,
    SiteImageRateLimitGuard,
  ],
  // O RSVP (F4) usa o endereço, o cookie do grupo e a prévia do site.
  exports: [PUBLIC_SITE_READER, PARTY_COOKIES, PreviewSessions],
})
export class SiteModule {}
