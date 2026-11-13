import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { ReconcilePayouts } from '../application/payouts/payout-transfers.use-cases';
import { ReconcilePayments } from '../application/reconcile-payments.use-case';

const logger = new Logger('PaymentReconciliation');

/** A fila da reconciliação (Publicar e pagar RN11): uma rodada por vez. */
export const PAYMENT_RECONCILIATION_QUEUE = 'payment-reconciliation';
export const PAYMENT_RECONCILIATION_PENDING_SCHEDULER_ID = 'payment-reconciliation-pending';
export const PAYMENT_RECONCILIATION_DAILY_SCHEDULER_ID = 'payment-reconciliation-daily';

// A cada 10 minutos, e às 4h no fuso de São Paulo (RN11).
const EVERY_10_MINUTES = '*/10 * * * *';
const AT_4AM = '0 4 * * *';

/** As duas rotinas; o nome do job é o id do agendamento. */
@Processor(PAYMENT_RECONCILIATION_QUEUE)
export class PaymentReconciliationProcessor extends WorkerHost {
  constructor(
    private readonly reconcile: ReconcilePayments,
    private readonly payouts: ReconcilePayouts,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    const now = new Date();
    const daily = job.name === PAYMENT_RECONCILIATION_DAILY_SCHEDULER_ID;
    const tally = daily
      ? await this.reconcile.daily({ now })
      : await this.reconcile.pending({ now });
    // Os repasses em processamento, na rodada diária (decisão 230, risco 5).
    if (daily) {
      const payouts = await this.payouts.execute({ now });
      if (payouts.paid || payouts.failed || payouts.pending)
        logger.log(
          `Repasses em processamento: ${payouts.paid} pagos, ${payouts.failed} falhos, ` +
            `${payouts.pending} sem resposta.`,
        );
    }
    if (tally.changed || tally.alerts || tally.errors)
      logger.log(
        `Reconciliação ${daily ? 'diária' : 'dos pendentes'}: ${tally.checked} conferidos, ` +
          `${tally.changed} corrigidos, ${tally.alerts} alertas, ${tally.errors} falhas.`,
      );
    return tally;
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    logger.warn(`Reconciliação falhou (${job?.name ?? '?'}): ${error.name}`);
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) as duas rotinas na subida do worker. */
@Injectable()
export class PaymentReconciliationScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(PAYMENT_RECONCILIATION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: PAYMENT_RECONCILIATION_PENDING_SCHEDULER_ID,
      cronPattern: EVERY_10_MINUTES,
      logger,
    });
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: PAYMENT_RECONCILIATION_DAILY_SCHEDULER_ID,
      cronPattern: AT_4AM,
      logger,
    });
  }
}
