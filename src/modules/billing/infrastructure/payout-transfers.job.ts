import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SendPayoutTransfer } from '../application/payouts/payout-transfers.use-cases';
import { PAYOUT_TRANSFERS_QUEUE, type SendPayoutTransferJob } from './payout-transfers.queue';

const logger = new Logger('PayoutTransfers');

/** O Pix de saída de um repasse em processamento (Repasse RN05). */
@Processor(PAYOUT_TRANSFERS_QUEUE)
export class PayoutTransfersProcessor extends WorkerHost {
  constructor(private readonly send: SendPayoutTransfer) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const { payoutId } = job.data as SendPayoutTransferJob;
    return this.send.execute({ payoutId, now: new Date() });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    logger.warn(`Pix de saída falhou (${job?.name ?? '?'}): ${error.name}`);
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}
