import { Module } from '@nestjs/common';
import { RsvpWriteRateLimit } from '../../shared/rate-limit/rsvp-write-rate-limit';
import { AccessModule } from '../access/access.module';
import { SiteModule } from '../site/site.module';
import { ChangeGuestResponse, SetRsvpDeadline } from './application/couple-responses.use-cases';
import { CoupleResponsesController } from './presentation/couple-responses.controller';
import {
  ListMessageTemplates,
  MessageTemplates,
  SaveMessageTemplate,
} from './application/message-templates.use-cases';
import { MESSAGE_TEMPLATE_STORE } from './application/ports/message-template-store.port';
import { PrismaMessageTemplateStore } from './infrastructure/prisma-message-template.store';
import { MessageTemplatesController } from './presentation/message-templates.controller';
import {
  DeliveryGuard,
  DeliveryMarker,
  GetDeliveryQueue,
  MarkDeliveries,
} from './application/deliveries.use-cases';
import { DELIVERY_STORE } from './application/ports/delivery-store.port';
import { PrismaDeliveryStore } from './infrastructure/prisma-delivery.store';
import { DeliveriesController } from './presentation/deliveries.controller';
import { DownloadQrCodes } from './application/qr-codes.use-case';
import { QR_RENDERER } from './application/ports/qr-renderer.port';
import { QrcodeRenderer } from './infrastructure/qrcode-renderer';
import { QrCodesController } from './presentation/qr-codes.controller';
import {
  ExportSongSuggestions,
  ListSongSuggestions,
  SongSuggestionsAccess,
} from './application/song-suggestions.use-cases';
import {
  SONG_SUGGESTIONS_FILE,
  SONG_SUGGESTION_READER,
} from './application/ports/song-suggestion-reader.port';
import { PrismaSongSuggestionReader } from './infrastructure/prisma-song-suggestion.reader';
import { SongSuggestionsXlsx } from './infrastructure/song-suggestions-xlsx';
import { SongSuggestionsController } from './presentation/song-suggestions.controller';
import { PARTY_LINKS } from '../guests/application/ports/party-links.port';
import { RandomPartyLinks } from '../guests/infrastructure/random-party-links';
import { RSVP_STORE } from './application/ports/rsvp-store.port';
import { RsvpSessions } from './application/rsvp-sessions.service';
import { GetRsvp, SubmitRsvp } from './application/rsvp.use-cases';
import { PrismaRsvpStore } from './infrastructure/prisma-rsvp.store';
import { RsvpController } from './presentation/rsvp.controller';

/** Contexto RSVP (F4): Confirmar presença no site do casal, o prazo e as respostas pelo casal. */
@Module({
  imports: [AccessModule, SiteModule],
  controllers: [
    RsvpController,
    CoupleResponsesController,
    MessageTemplatesController,
    DeliveriesController,
    QrCodesController,
    SongSuggestionsController,
  ],
  providers: [
    { provide: RSVP_STORE, useClass: PrismaRsvpStore },
    RsvpSessions,
    RsvpWriteRateLimit,
    GetRsvp,
    SubmitRsvp,
    SetRsvpDeadline,
    ChangeGuestResponse,
    { provide: MESSAGE_TEMPLATE_STORE, useClass: PrismaMessageTemplateStore },
    MessageTemplates,
    ListMessageTemplates,
    SaveMessageTemplate,
    { provide: DELIVERY_STORE, useClass: PrismaDeliveryStore },
    { provide: PARTY_LINKS, useClass: RandomPartyLinks },
    DeliveryGuard,
    DeliveryMarker,
    GetDeliveryQueue,
    MarkDeliveries,
    { provide: QR_RENDERER, useClass: QrcodeRenderer },
    DownloadQrCodes,
    { provide: SONG_SUGGESTION_READER, useClass: PrismaSongSuggestionReader },
    { provide: SONG_SUGGESTIONS_FILE, useClass: SongSuggestionsXlsx },
    SongSuggestionsAccess,
    ListSongSuggestions,
    ExportSongSuggestions,
  ],
})
export class RsvpModule {}
