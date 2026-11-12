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
  ],
})
export class RsvpModule {}
