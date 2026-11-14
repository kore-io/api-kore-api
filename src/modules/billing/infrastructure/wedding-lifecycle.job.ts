import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { upsertDailyScheduler } from '../../../shared/jobs/daily-scheduler';
import { AdvanceWeddingLifecycle } from '../application/advance-wedding-lifecycle.use-case';
import { PurgeRetainedWeddings } from '../application/purge-retained-weddings.use-case';
import { ReleaseCommissions } from '../application/release-commissions.use-case';

export const WEDDING_LIFECYCLE_QUEUE = 'wedding-lifecycle';
export const WEDDING_LIFECYCLE_SCHEDULER_ID = 'advance-wedding-lifecycle';
// Todo dia às 3h30, horário de Brasília: depois do pós-evento (3h15) e da
// meia-noite em todos os fusos do Brasil (o Acre fica 2 horas atrás; B4-7).
const DAILY_AT_3_30AM = '30 3 * * *';

const logger = new Logger('WeddingLifecycle');

/**
 * A carência, o expirado e os avisos de saída do ar (Data de saída do ar RN02
 * e RN03), a liberação das comissões (Comissões do indicador RN02) e a
 * retenção com o expurgo (Retenção e expurgo RN02 a RN05).
 */
@Processor(WEDDING_LIFECYCLE_QUEUE)
export class WeddingLifecycleProcessor extends WorkerHost {
  constructor(
    private readonly advance: AdvanceWeddingLifecycle,
    private readonly commissions: ReleaseCommissions,
    private readonly retention: PurgeRetainedWeddings,
  ) {
    super();
  }

  async process(): Promise<unknown> {
    const now = new Date();
    const tally = await this.advance.execute({ now });
    // A liberação das comissões na mesma rodada diária (Comissões RN02).
    const { released } = await this.commissions.execute({ now });
    if (released > 0) logger.log(`Comissões liberadas: ${released}.`);
    // Depois das passagens: o expirado de hoje já tem o purgeAt.
    const purge = await this.retention.execute({ now });
    logger.log(
      `Retenção: ${purge.notices} avisos, ${purge.purged} expurgos, ${purge.failed} pulados.`,
    );
    logger.log(
      `Ciclo de vida: ${tally.grace} em carência, ${tally.expired} expirados, ` +
        `${tally.notices} avisos, ${tally.errors} falhas.`,
    );
    return tally;
  }

  // Sem ouvinte de 'error', o worker derruba o processo quando o Redis cai.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    logger.warn(`Worker sem Redis: ${error.name}`);
  }
}

/** Registra (ou atualiza) o agendamento diário na subida do worker. */
@Injectable()
export class WeddingLifecycleScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(WEDDING_LIFECYCLE_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await upsertDailyScheduler({
      queue: this.queue,
      schedulerId: WEDDING_LIFECYCLE_SCHEDULER_ID,
      cronPattern: DAILY_AT_3_30AM,
      logger,
    });
  }
}
