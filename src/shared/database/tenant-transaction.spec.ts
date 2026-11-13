import type { PrismaService } from './prisma.service';
import {
  PartySiteNotLiveError,
  PartyTransactionRevokedError,
  TenantTransaction,
} from './tenant-transaction';

function tenantWith({ commits }: { commits: boolean }) {
  const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
  const prisma = {
    $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
      const result = await work(tx);
      if (!commits) throw new Error('commit falhou');
      return result;
    }),
  } as unknown as PrismaService;
  return new TenantTransaction(prisma);
}

describe('TenantTransaction (decisões 153 e 170)', () => {
  it('decisão 170 - o trabalho agendado roda só depois do commit', async () => {
    const tenant = tenantWith({ commits: true });
    const order: string[] = [];

    await tenant.run({
      userId: 'u1',
      work: () => {
        tenant.schedule(() => {
          order.push('depois do commit');
          return Promise.resolve();
        });
        order.push('dentro da transação');
        return Promise.resolve();
      },
    });

    expect(order).toEqual(['dentro da transação', 'depois do commit']);
  });

  it('decisão 170 - se a transação desfaz, o trabalho agendado não roda', async () => {
    const tenant = tenantWith({ commits: false });
    const task = jest.fn().mockResolvedValue(undefined);

    await expect(
      tenant.run({
        userId: 'u1',
        work: () => {
          tenant.schedule(task);
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('commit falhou');
    expect(task).not.toHaveBeenCalled();
  });

  it('uma falha depois do commit não muda a resposta nem impede as outras tarefas', async () => {
    const tenant = tenantWith({ commits: true });
    const second = jest.fn().mockResolvedValue(undefined);

    const result = await tenant.run({
      userId: 'u1',
      work: () => {
        tenant.schedule(() => Promise.reject(new Error('SMTP fora')));
        tenant.schedule(second);
        return Promise.resolve('ok');
      },
    });

    expect(result).toBe('ok');
    expect(second).toHaveBeenCalled();
  });

  it('agendar fora da transação da requisição é erro de programação', () => {
    expect(() => tenantWith({ commits: true }).schedule(() => Promise.resolve())).toThrow(
      /fora da transação/,
    );
  });

  describe('transação do grupo (RSVP RN13; decisão 217(a))', () => {
    function partyTenant({ context }: { context: unknown }) {
      const calls: unknown[][] = [];
      const tx = {
        $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push([strings.join('?'), ...values]);
          return Promise.resolve(
            strings.join('').includes('party_transaction_context') ? [{ context }] : [],
          );
        }),
        $executeRaw: jest.fn((strings: TemplateStringsArray) => {
          calls.push([strings.join('?')]);
          return Promise.resolve(0);
        }),
      };
      const prisma = {
        $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
      } as unknown as PrismaService;
      return { tenant: new TenantTransaction(prisma), calls };
    }

    it('define o casamento e o grupo, sem pessoa, entra no papel do grupo e reconfere o grupo antes do trabalho', async () => {
      const { tenant, calls } = partyTenant({
        context: { siteState: 'live', status: 'published' },
      });
      const task = jest.fn().mockResolvedValue(undefined);

      const result = await tenant.runAsParty({
        weddingId: 'w1',
        partyId: 'p1',
        linkVersion: 2,
        work: (received) => {
          tenant.schedule(task);
          return Promise.resolve(received);
        },
      });

      // O estado do site não vai ao trabalho: só o contexto do casamento.
      expect(result).toEqual({ status: 'published' });
      expect(calls.map((call) => call.slice(1))).toEqual([
        ['app.wedding_id', 'w1'],
        ['app.party_id', 'p1'],
        [],
        [2],
      ]);
      expect(calls[2][0]).toBe('SET LOCAL ROLE kore_party');
      expect(task).toHaveBeenCalled();
    });

    it.each(['expired', 'unavailable'] as const)(
      'Data de saída do ar RN07 e RN08 - site %s: nada roda e o erro diz o estado',
      async (siteState) => {
        const { tenant } = partyTenant({ context: { siteState } });
        const work = jest.fn();
        await expect(
          tenant.runAsParty({ weddingId: 'w1', partyId: 'p1', linkVersion: 1, work }),
        ).rejects.toEqual(new PartySiteNotLiveError(siteState));
        expect(work).not.toHaveBeenCalled();
      },
    );

    it('RN11 - grupo que não vale mais: nada roda', async () => {
      const { tenant } = partyTenant({ context: null });
      const work = jest.fn();

      await expect(
        tenant.runAsParty({ weddingId: 'w1', partyId: 'p1', linkVersion: 1, work }),
      ).rejects.toBeInstanceOf(PartyTransactionRevokedError);
      expect(work).not.toHaveBeenCalled();
    });
  });
});
