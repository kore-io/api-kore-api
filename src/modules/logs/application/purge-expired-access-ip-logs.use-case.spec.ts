import type { AccessIpLogRetention } from './ports/access-ip-log-retention.port';
import type { ApplicationLogWriter } from './ports/application-log-writer.port';
import { PurgeExpiredAccessIpLogs } from './purge-expired-access-ip-logs.use-case';

function buildUseCase({ deleted }: { deleted: number }) {
  const deleteOccurredBefore = jest.fn().mockResolvedValue(deleted);
  const record = jest.fn().mockResolvedValue(undefined);
  const retention: AccessIpLogRetention = { deleteOccurredBefore };
  const applicationLog: ApplicationLogWriter = { record };
  return {
    useCase: new PurgeExpiredAccessIpLogs(retention, applicationLog),
    deleteOccurredBefore,
    record,
  };
}

describe('PurgeExpiredAccessIpLogs (decisões 116 e 137)', () => {
  const now = new Date('2026-11-05T03:00:00.000Z');
  const cutoff = new Date('2026-05-05T03:00:00.000Z');

  it('dada a rotina diária, quando roda, então apaga o IP real anterior a 6 meses', async () => {
    const { useCase, deleteOccurredBefore } = buildUseCase({ deleted: 3 });

    const result = await useCase.execute({ now });

    expect(deleteOccurredBefore).toHaveBeenCalledWith({ cutoff });
    expect(result).toEqual({ deleted: 3, cutoff });
  });

  it.each([3, 0])(
    'dados %i registros apagados, quando roda, então registra a execução no log da aplicação',
    async (deleted) => {
      const { useCase, record } = buildUseCase({ deleted });

      await useCase.execute({ now });

      expect(record).toHaveBeenCalledWith({
        entry: {
          action: 'access_ip_log.purged',
          actorKind: 'system',
          data: { deleted, cutoff: cutoff.toISOString() },
        },
      });
    },
  );
});
