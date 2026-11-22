import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { RefundQueue } from '@/modules/billing/application/ports/refund-queue.port';

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
    // concluído sai, e a tentativa seguinte tem outro id. O Tentar o estorno de
    // novo (RN05) usa o mesmo id da tentativa 1, para a reconciliação não pôr
    // um segundo job ao lado do dele (sugestão do Crivo no DoD da F3).
    const jobId = `refund-${paymentId}-${attempt}`;
    // O job que lançou erro fica guardado (removeOnFail) e barraria a mesma
    // tentativa depois do Tentar o estorno de novo (que zera a contagem,
    // Pagamentos RN05): o falho sai antes. O que espera ou roda continua barrando.
    const existing = await this.queue.getJob(jobId);
    if (existing && (await existing.isFailed())) await existing.remove();
    await this.queue.add('refund', data, {
      jobId,
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
