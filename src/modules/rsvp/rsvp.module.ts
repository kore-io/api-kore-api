import { Module } from '@nestjs/common';
import { RsvpWriteRateLimit } from '../../shared/rate-limit/rsvp-write-rate-limit';
import { AccessModule } from '../access/access.module';
import { SiteModule } from '../site/site.module';
import { ChangeGuestResponse, SetRsvpDeadline } from './application/couple-responses.use-cases';
import { CoupleResponsesController } from './presentation/couple-responses.controller';
import { RSVP_STORE } from './application/ports/rsvp-store.port';
import { RsvpSessions } from './application/rsvp-sessions.service';
import { GetRsvp, SubmitRsvp } from './application/rsvp.use-cases';
import { PrismaRsvpStore } from './infrastructure/prisma-rsvp.store';
import { RsvpController } from './presentation/rsvp.controller';

/** Contexto RSVP (F4): Confirmar presença no site do casal, o prazo e as respostas pelo casal. */
@Module({
  imports: [AccessModule, SiteModule],
  controllers: [RsvpController, CoupleResponsesController],
  providers: [
    { provide: RSVP_STORE, useClass: PrismaRsvpStore },
    RsvpSessions,
    RsvpWriteRateLimit,
    GetRsvp,
    SubmitRsvp,
    SetRsvpDeadline,
    ChangeGuestResponse,
  ],
})
export class RsvpModule {}
