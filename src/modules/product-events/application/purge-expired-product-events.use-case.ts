import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_LOG_WRITER,
  type ApplicationLogWriter,
} from '../../logs/application/ports/application-log-writer.port';
import { productEventRetentionCutoff } from '../domain/product-event-retention';
import {
  PRODUCT_EVENT_RETENTION,
  type ProductEventRetention,
} from './ports/product-event-retention.port';

export const PRODUCT_EVENT_PURGED_ACTION = 'product_event.purged';

/**
 * Apaga os eventos de produto com mais de 18 meses e registra a execução no
 * log da aplicação, mesmo sem nada a apagar (ADR de multi-tenant, item 5;
 * decisão 138).
 */
@Injectable()
export class PurgeExpiredProductEvents {
  constructor(
    @Inject(PRODUCT_EVENT_RETENTION) private readonly retention: ProductEventRetention,
    @Inject(APPLICATION_LOG_WRITER) private readonly applicationLog: ApplicationLogWriter,
  ) {}

  async execute({ now }: { now: Date }): Promise<{ deleted: number; cutoff: Date }> {
    const cutoff = productEventRetentionCutoff({ now });
    const deleted = await this.retention.deleteOccurredBefore({ cutoff });
    await this.applicationLog.record({
      entry: {
        action: PRODUCT_EVENT_PURGED_ACTION,
        actorKind: 'system',
        data: { deleted, cutoff: cutoff.toISOString() },
      },
    });
    return { deleted, cutoff };
  }
}
