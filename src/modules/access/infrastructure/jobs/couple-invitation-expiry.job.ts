import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '@/shared/jobs/daily-scheduler';
import { RevertExpiredCoupleInvitations } from '@/modules/access/application/weddings/revert-expired-couple-invitations.use-case';

export const COUPLE_INVITATION_EXPIRY_QUEUE = 'couple-invitation-expiry';
export const COUPLE_INVITATION_EXPIRY_SCHEDULER_ID = 'revert-expired-couple-invitations';
// Todo dia às 3h30, horário de Brasília, junto da rotina do ciclo de vida (decisão 297).
const DAILY_AT_3_30AM = '30 3 * * *';

const logger = new Logger('CoupleInvitationExpiry');

/** O link do casal venceu e era o último convite: o casamento volta a rascunho (decisão 297). */
@Processor(COUPLE_INVITATION_EXPIRY_QUEUE)
export class CoupleInvitationExpiryProcessor extends WorkerHost {
  constructor(private readonly revert: RevertExpiredCoupleInvitations) {
    super();
  }

  async process(): Promise<{ reverted: number }> {
    const result = await this.revert.execute({ now: new Date() });
    logger.log(`Aguardando o casal sem convite: ${result.reverted} voltaram a rascunho.`);
    return result;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

@Injectable()
export class CoupleInvitationExpiryScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(COUPLE_INVITATION_EXPIRY_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: COUPLE_INVITATION_EXPIRY_SCHEDULER_ID,
      cronPattern: DAILY_AT_3_30AM,
      logger,
    });
  }
}
