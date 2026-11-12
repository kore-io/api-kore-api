import type { PrismaService } from './prisma.service';
import { TenantTransaction } from './tenant-transaction';

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
});
