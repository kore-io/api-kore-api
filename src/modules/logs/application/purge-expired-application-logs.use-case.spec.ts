import type { ApplicationLogRetention } from './ports/application-log-retention.port';
import type { ApplicationLogWriter } from './ports/application-log-writer.port';
import { PurgeExpiredApplicationLogs } from './purge-expired-application-logs.use-case';

function buildUseCase({ deleted }: { deleted: number }) {
  const deleteCreatedBefore = jest.fn().mockResolvedValue(deleted);
  const record = jest.fn().mockResolvedValue(undefined);
  const retention: ApplicationLogRetention = { deleteCreatedBefore };
  const applicationLog: ApplicationLogWriter = { record };
  return {
    useCase: new PurgeExpiredApplicationLogs(retention, applicationLog),
    deleteCreatedBefore,
    record,
  };
}

describe('PurgeExpiredApplicationLogs (decisão 137)', () => {
  const now = new Date('2026-11-05T03:30:00.000Z');
  const cutoff = new Date('2021-11-05T03:30:00.000Z');

  it('dada a rotina diária, quando roda, então apaga o log anterior a 5 anos', async () => {
    const { useCase, deleteCreatedBefore } = buildUseCase({ deleted: 2 });

    expect(await useCase.execute({ now })).toEqual({ deleted: 2, cutoff });
    expect(deleteCreatedBefore).toHaveBeenCalledWith({ cutoff });
  });

  it.each([2, 0])(
    'dados %i registros apagados, quando roda, então registra a execução no log da aplicação',
    async (deleted) => {
      const { useCase, record } = buildUseCase({ deleted });

      await useCase.execute({ now });

      expect(record).toHaveBeenCalledWith({
        entry: {
          action: 'application_log.purged',
          actorKind: 'system',
          data: { deleted, cutoff: cutoff.toISOString() },
        },
      });
    },
  );
});
