import { Module } from '@nestjs/common';
import { RsvpWriteRateLimit } from '../../shared/rate-limit/rsvp-write-rate-limit';
import { SiteModule } from '../site/site.module';
import { RSVP_STORE } from './application/ports/rsvp-store.port';
import { RsvpSessions } from './application/rsvp-sessions.service';
import { GetRsvp, SubmitRsvp } from './application/rsvp.use-cases';
import { PrismaRsvpStore } from './infrastructure/prisma-rsvp.store';
import { RsvpController } from './presentation/rsvp.controller';

/** Contexto RSVP (F4): Confirmar presença no site do casal. */
@Module({
  imports: [SiteModule],
  controllers: [RsvpController],
  providers: [
    { provide: RSVP_STORE, useClass: PrismaRsvpStore },
    RsvpSessions,
    RsvpWriteRateLimit,
    GetRsvp,
    SubmitRsvp,
  ],
})
export class RsvpModule {}
