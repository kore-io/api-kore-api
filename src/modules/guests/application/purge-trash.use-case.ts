import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { TRASH_PURGE, type PurgeCounts, type TrashPurge } from './ports/trash-purge.port';

export const GUESTS_PURGED_ACTION = 'guests.purged';

/**
 * Expurgo diário da lixeira (Lixeira RN10 e RN11; decisão 186, item 15): apaga
 * de vez o que passou do purgeAt e grava um registro por execução, com as
 * contagens e o ator system, como o expurgo do IP real.
 */
@Injectable()
export class PurgeTrash {
  constructor(
    @Inject(TRASH_PURGE) private readonly purge: TrashPurge,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<PurgeCounts> {
    const counts = await this.purge.purgeDue({ now });
    await this.applicationLog.record({
      entry: {
        action: GUESTS_PURGED_ACTION,
        actorKind: 'system',
        data: { ...counts, now: now.toISOString() },
      },
    });
    return counts;
  }
}
