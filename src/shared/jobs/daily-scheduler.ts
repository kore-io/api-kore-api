import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

const SCHEDULE_WAIT_MS = 2_000;

/**
 * Registra (ou atualiza) um agendamento com id fixo na subida do worker
 * (decisão 135). Com o Redis fora, o worker sobe assim mesmo (decisão 97,
 * item 3) e o agendamento é registrado de novo na próxima subida.
 */
export async function upsertDailyScheduler({
  queue,
  schedulerId,
  cronPattern,
  logger,
}: {
  queue: Queue;
  schedulerId: string;
  cronPattern: string;
  logger: Logger;
}): Promise<void> {
  queue.on('error', (error: Error) => logger.warn(`Fila sem Redis: ${error.name}`));
  const scheduled = queue
    .upsertJobScheduler(schedulerId, { pattern: cronPattern, tz: 'America/Sao_Paulo' })
    .then(
      () => true,
      () => false,
    );
  const waited = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), SCHEDULE_WAIT_MS).unref();
  });
  if (!(await Promise.race([scheduled, waited]))) {
    logger.warn(`Rotina ${schedulerId} não agendada: Redis indisponível.`);
  }
}
