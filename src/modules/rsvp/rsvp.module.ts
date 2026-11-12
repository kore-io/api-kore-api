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
import { RSVP_STORE } from './application/ports/rsvp-store.port';
import { RsvpSessions } from './application/rsvp-sessions.service';
import { GetRsvp, SubmitRsvp } from './application/rsvp.use-cases';
import { PrismaRsvpStore } from './infrastructure/prisma-rsvp.store';
import { RsvpController } from './presentation/rsvp.controller';

/** Contexto RSVP (F4): Confirmar presença no site do casal, o prazo e as respostas pelo casal. */
@Module({
  imports: [AccessModule, SiteModule],
  controllers: [RsvpController, CoupleResponsesController, MessageTemplatesController],
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
  ],
})
export class RsvpModule {}
