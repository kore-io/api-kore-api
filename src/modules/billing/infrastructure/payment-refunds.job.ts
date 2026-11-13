import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CancelPendingPayment } from '../application/cancel-pending-payment';
import { ProcessRefund } from '../application/process-refund.use-case';
import { type CancelPendingJob, PAYMENT_REFUNDS_QUEUE, type RefundJob } from './refunds.queue';

const logger = new Logger('PaymentRefunds');

/**
 * Os estornos pela porta (Pagamentos e arrependimento RN04 e RN05) e o
 * cancelamento do pendente do casamento bloqueado (Casamento bloqueado RN06).
 */
@Processor(PAYMENT_REFUNDS_QUEUE)
export class PaymentRefundsProcessor extends WorkerHost {
  constructor(
    private readonly refund: ProcessRefund,
    private readonly cancelPending: CancelPendingPayment,
  ) {
    super();
  }

  process(job: Job): Promise<unknown> {
    // O pendente do casamento bloqueado (Casamento bloqueado RN06).
    if (job.name === 'cancel-pending')
      return this.cancelPending.execute({
        paymentId: (job.data as CancelPendingJob).paymentId,
        reason: 'wedding_blocked',
        now: new Date(),
      });
    return this.refund.execute({ paymentId: (job.data as RefundJob).paymentId, now: new Date() });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    logger.warn(`Estorno falhou no job (${job?.id ?? '?'}): ${error.name}`);
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}
