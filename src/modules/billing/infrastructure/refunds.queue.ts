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
}
