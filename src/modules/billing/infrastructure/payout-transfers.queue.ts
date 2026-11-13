import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { PayoutTransferQueue } from '../application/ports/payout-transfer-queue.port';

export const PAYOUT_TRANSFERS_QUEUE = 'payout-transfers';

export interface SendPayoutTransferJob {
  payoutId: string;
}

/**
 * Um job por repasse (jobId fixo): o mesmo Pagar repetido não manda dois Pix.
 * Sem novas tentativas automáticas: sem resposta, o repasse fica em
 * processamento e só o Admin tenta de novo, depois de consultar (B7-2).
 */
@Injectable()
export class BullmqPayoutTransferQueue implements PayoutTransferQueue {
  constructor(@InjectQueue(PAYOUT_TRANSFERS_QUEUE) private readonly queue: Queue) {}

  async enqueue({ payoutId }: { payoutId: string }): Promise<void> {
    const job: SendPayoutTransferJob = { payoutId };
    await this.queue.add('send', job, {
      jobId: `payout-${payoutId}`,
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }
}
