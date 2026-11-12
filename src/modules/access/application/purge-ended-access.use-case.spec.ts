import type { ApplicationLogWriter } from '../../logs/application/ports/application-log-writer.port';
import type { AccessCleanup } from './ports/access-cleanup.port';
import { PurgeEndedAccess } from './purge-ended-access.use-case';

describe('PurgeEndedAccess (limpeza de sessões e pedidos de login)', () => {
  const now = new Date('2026-11-06T08:30:00.000Z');

  it.each([
    [3, 7],
    [0, 0],
  ])(
    'dadas %i sessões e %i pedidos a apagar, quando roda, então apaga e registra a execução',
    async (sessions, loginChallenges) => {
      const cleanup: AccessCleanup = {
        deleteEndedSessions: jest.fn().mockResolvedValue(sessions),
        deleteLoginChallengesCreatedBefore: jest.fn().mockResolvedValue(loginChallenges),
        clearExpiredCoupleLinkTokens: jest.fn().mockResolvedValue(2),
      };
      const record = jest.fn().mockResolvedValue(undefined);
      const applicationLog: ApplicationLogWriter = { record };

      const result = await new PurgeEndedAccess(cleanup, applicationLog).execute({ now });

      expect(result).toEqual({ sessions, loginChallenges, coupleLinkTokens: 2 });
      // N1(b): o token cifrado do link vencido sai na mesma limpeza.
      expect(cleanup.clearExpiredCoupleLinkTokens).toHaveBeenCalledWith({ now });
      expect(cleanup.deleteEndedSessions).toHaveBeenCalledWith({ now });
      // RN04: o pedido da última hora ainda conta no limite e fica.
      expect(cleanup.deleteLoginChallengesCreatedBefore).toHaveBeenCalledWith({
        createdBefore: new Date('2026-11-06T07:30:00.000Z'),
      });
      expect(record).toHaveBeenCalledWith({
        entry: {
          action: 'access_cleanup.purged',
          actorKind: 'system',
          data: { sessions, loginChallenges, coupleLinkTokens: 2, now: now.toISOString() },
        },
      });
    },
  );
});
