import type { BackofficePrismaService } from './backoffice-prisma.service';
import { BackofficeTransaction } from './backoffice-transaction';

describe('BackofficeTransaction (Publicar e pagar RN05; revisão técnica G5)', () => {
  const tx = {};
  const db = {
    $transaction: jest.fn((work: (client: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as BackofficePrismaService;

  it('G5 - o que foi agendado roda só depois do commit, na ordem', async () => {
    const transaction = new BackofficeTransaction(db);
    const order: string[] = [];
    const result = await transaction.run(() => {
      transaction.schedule(() => {
        order.push('e-mail');
        return Promise.resolve();
      });
      transaction.schedule(() => {
        order.push('evento');
        return Promise.resolve();
      });
      order.push('gravou');
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(order).toEqual(['gravou', 'e-mail', 'evento']);
  });

  it('G5 - a transação desfeita descarta o agendado', async () => {
    const failing = {
      $transaction: jest.fn(async (work: (client: unknown) => Promise<unknown>) => {
        await work(tx);
        throw new Error('rollback');
      }),
    } as unknown as BackofficePrismaService;
    const transaction = new BackofficeTransaction(failing);
    const sent = jest.fn<void, []>();
    await expect(
      transaction.run(() => {
        transaction.schedule(() => Promise.resolve(sent()));
        return Promise.resolve();
      }),
    ).rejects.toThrow('rollback');
    expect(sent).not.toHaveBeenCalled();
  });

  it('G5 - a falha de uma tarefa não impede as outras nem muda o resultado', async () => {
    const transaction = new BackofficeTransaction(db);
    const second = jest.fn<void, []>();
    await transaction.run(() => {
      transaction.schedule(() => Promise.reject(new Error('smtp')));
      transaction.schedule(() => Promise.resolve(second()));
      return Promise.resolve();
    });
    expect(second).toHaveBeenCalled();
  });

  it('fora da transação, agendar é erro', () => {
    expect(() => new BackofficeTransaction(db).schedule(() => Promise.resolve())).toThrow(
      /fora da transação/,
    );
  });
});
