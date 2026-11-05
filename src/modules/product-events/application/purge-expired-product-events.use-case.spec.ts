import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import type { ProductEventRetention } from './ports/product-event-retention.port';
import { PurgeExpiredProductEvents } from './purge-expired-product-events.use-case';

describe('PurgeExpiredProductEvents (decisões 135 e 138)', () => {
  const now = new Date('2026-11-05T05:00:00.000Z');
  const cutoff = new Date('2025-05-05T05:00:00.000Z');

  it.each([4, 0])(
    'dados %i eventos vencidos, quando roda, então apaga os anteriores a 18 meses e registra a execução',
    async (deleted) => {
      const deleteOccurredBefore = jest.fn().mockResolvedValue(deleted);
      const record = jest.fn().mockResolvedValue(undefined);
      const retention: ProductEventRetention = { deleteOccurredBefore };
      const applicationLog: ApplicationLogWriter = { record };

      const result = await new PurgeExpiredProductEvents(retention, applicationLog).execute({
        now,
      });

      expect(result).toEqual({ deleted, cutoff });
      expect(deleteOccurredBefore).toHaveBeenCalledWith({ cutoff });
      expect(record).toHaveBeenCalledWith({
        entry: {
          action: 'product_event.purged',
          actorKind: 'system',
          data: { deleted, cutoff: cutoff.toISOString() },
        },
      });
    },
  );
});
