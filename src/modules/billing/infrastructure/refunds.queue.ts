import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { RefundQueue } from '../application/ports/refund-queue.port';

/** A fila dos estornos (Pagamentos e arrependimento RN04 e RN05). */
export const PAYMENT_REFUNDS_QUEUE = 'payment-refunds';

export interface RefundJob {
  paymentId: string;
  attempt: number;
}

export interface CancelPendingJob {
  paymentId: string;
  reason?: 'wedding_blocked' | 'wedding_deletion' | 'courtesy_extended';
}

@Injectable()
export class BullmqRefundQueue implements RefundQueue {
  constructor(@InjectQueue(PAYMENT_REFUNDS_QUEUE) private readonly queue: Queue) {}

  async enqueue({
    paymentId,
    attempt,
    delayMs,
  }: {
    paymentId: string;
    attempt: number;
    delayMs: number;
  }): Promise<void> {
    const data: RefundJob = { paymentId, attempt };
    // O id fixo por pagamento e tentativa (RN04): o repetido não entra. O job
    // concluído sai, e a tentativa seguinte tem outro id.
    await this.queue.add('refund', data, {
      jobId: `refund-${paymentId}-${attempt}`,
      delay: delayMs,
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  async enqueueCancel({
    paymentId,
    reason = 'wedding_blocked',
  }: {
    paymentId: string;
    reason?: 'wedding_blocked' | 'wedding_deletion' | 'courtesy_extended';
  }): Promise<void> {
    const data: CancelPendingJob = { paymentId, reason };
    await this.queue.add('cancel-pending', data, {
      // Um id por motivo: o job falho do bloqueio (guardado em removeOnFail) não
      // barra o da exclusão. O do bloqueio mantém o id de antes.
      jobId: reason === 'wedding_blocked' ? `cancel-${paymentId}` : `cancel-${reason}-${paymentId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }
}
